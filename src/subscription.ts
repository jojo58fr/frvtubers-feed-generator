import { Insertable } from 'kysely'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { Post } from './db/schema'
import {
  baselineRegexKeywords,
  getAuthorPriority,
  hasFrenchSignal,
  vtuberTextKeywords,
} from './data/vtuberRegistry'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate: Insertable<Post>[] = []
    const logPosts = shouldLogPosts()

    for (const create of ops.posts.creates) {
      const priority = getAuthorPriority(create.author)
      const text = create.record.text ?? ''
      const normalizedText = text.toLowerCase()
      const languages =
        create.record.langs?.map((lang) => lang.toLowerCase()) ?? []
      const hasFrenchLang = languages.includes('fr')
      const hasEnglishLang = languages.includes('en')
      const hasFrenchMarkers = hasFrenchSignal(text)
      const hasExcludedKeyword = excludedTextKeywords.some((keyword) =>
        normalizedText.includes(keyword),
      )
      if (hasExcludedKeyword) continue

      const hasKeywordMatch =
        vtuberTextKeywords.some((keyword) =>
          normalizedText.includes(keyword),
        ) || baselineRegexKeywords.some((regex) => regex.test(text))

      const hasAllowedLanguage =
        create.record.langs?.some((lang) =>
          allowedLanguageCodes.has(lang.toLowerCase()),
        ) ?? false

      if (hasEnglishLang && !hasFrenchLang && !hasFrenchMarkers) {
        if (logPosts) {
          /*console.log(
            '[firehose] skipped english-only post',
            formatLogPayload({
              uri: create.uri,
              author: create.author,
              priority,
              text,
              reason: 'english-no-fr-signal',
            }),
          )*/
        }
        continue
      }

      if (priority === 0) {
        if (!hasAllowedLanguage) continue
        if (!hasKeywordMatch) continue
      } else if (!hasKeywordMatch && !hasAllowedLanguage) {
        // Keep known vtubers even if languages are missing, but
        // still require at least one signal to avoid junk.
        continue
      }

      postsToCreate.push({
        uri: create.uri,
        cid: create.cid,
        author: create.author,
        priority,
        indexedAt: new Date().toISOString(),
      })

      if (logPosts) {
        console.log(
          '[firehose] accepted post',
          formatLogPayload({
            uri: create.uri,
            author: create.author,
            priority,
            text,
          }),
        )
      }
    }

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}

const allowedLanguageCodes = new Set(['fr', 'en'])

const excludedTextKeywords = ['ririmiaou', 'ririgaki', 'ai generated', 'genai']

const shouldLogPosts = (): boolean =>
  (process.env.FEEDGEN_LOG_POSTS ?? '').toLowerCase() === 'true'

const formatLogPayload = (payload: {
  uri: string
  author: string
  priority: number
  text: string
  reason?: string
}) => ({
  ...payload,
  text:
    payload.text.length > 280 ? `${payload.text.slice(0, 280)}…` : payload.text,
})
