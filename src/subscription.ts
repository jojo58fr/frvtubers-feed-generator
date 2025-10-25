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
  vtuberTextKeywords,
} from './data/vtuberRegistry'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate: Insertable<Post>[] = []

    for (const create of ops.posts.creates) {
      const priority = getAuthorPriority(create.author)
      const text = create.record.text ?? ''
      const normalizedText = text.toLowerCase()
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

const excludedTextKeywords = ['ririmiaou']
