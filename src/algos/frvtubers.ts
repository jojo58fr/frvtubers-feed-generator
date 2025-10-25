import { createHash } from 'crypto'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

// max 15 chars
export const shortname = 'frvtubers'

export const handler = async (ctx: AppContext, params: QueryParams) => {
  const fetchLimit = Math.min(Math.max(params.limit * 3, params.limit + 10), 200)

  let builder = ctx.db
    .selectFrom('post')
    .selectAll()
    .orderBy('indexedAt', 'desc')
    .orderBy('priority', 'desc')
    .orderBy('cid', 'desc')

  if (params.cursor) {
    const cursor = decodeCursor(params.cursor)
    builder = builder.where(({ eb, or, and }) =>
      or([
        eb('post.indexedAt', '<', cursor.indexedAt),
        and([
          eb('post.indexedAt', '=', cursor.indexedAt),
          eb('post.priority', '<', cursor.priority),
        ]),
        and([
          eb('post.indexedAt', '=', cursor.indexedAt),
          eb('post.priority', '=', cursor.priority),
          eb('post.cid', '<', cursor.cid),
        ]),
      ]),
    )
  }
  const candidates = await builder.limit(fetchLimit).execute()

  const selected = selectWeightedPosts(
    candidates as unknown as SelectedPost[],
    params.limit,
  )

  const feed = selected.map((row) => ({
    post: row.uri,
  }))

  let cursor: string | undefined
  const last = selected.at(-1)
  if (last) {
    cursor = encodeCursor({
      indexedAt: last.indexedAt,
      priority: last.priority ?? 0,
      cid: last.cid,
    })
  }

  return {
    cursor,
    feed,
  }
}

type CursorState = {
  indexedAt: string
  priority: number
  cid: string
}

const cursorDelimiter = '::'

const encodeCursor = (cursor: CursorState): string =>
  [
    cursor.indexedAt,
    cursor.priority.toString(10),
    cursor.cid,
  ].join(cursorDelimiter)

const decodeCursor = (cursor: string): CursorState => {
  const [indexedAt, priority, cid] = cursor.split(cursorDelimiter)
  return {
    indexedAt,
    priority: Number(priority) || 0,
    cid,
  }
}

type SelectedPost = {
  uri: string
  cid: string
  indexedAt: string
  priority: number
}

const selectWeightedPosts = (
  posts: Array<SelectedPost>,
  limit: number,
): Array<SelectedPost> => {
  if (posts.length <= limit) {
    return posts.slice(0, limit)
  }

  const selected: SelectedPost[] = []
  const used = new Set<string>()

  for (const post of posts) {
    if (selected.length >= limit) break
    const acceptance =
      baseAcceptanceProbability[normalizePriority(post.priority)] ?? 0.5
    if (acceptance >= 1) {
      selected.push(post)
      used.add(post.uri)
      continue
    }
    const score = deterministicScore(post.uri)
    if (score <= acceptance) {
      selected.push(post)
      used.add(post.uri)
    }
  }

  if (selected.length < limit) {
    for (const post of posts) {
      if (used.has(post.uri)) continue
      selected.push(post)
      used.add(post.uri)
      if (selected.length >= limit) break
    }
  }

  return selected.slice(0, limit)
}

const baseAcceptanceProbability: Record<number, number> = {
  2: 1,
  1: 0.65,
  0: 0.35,
}

const normalizePriority = (priority: number): number => {
  if (priority >= 2) return 2
  if (priority <= 0) return 0
  return priority
}

const deterministicScore = (uri: string): number => {
  const hash = createHash('sha256').update(uri).digest()
  const value = hash.readUInt32BE(0)
  return value / 0xffffffff
}
