import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

// max 15 chars
export const shortname = 'frvtubers'

export const handler = async (ctx: AppContext, params: QueryParams) => {
  let builder = ctx.db
    .selectFrom('post')
    .selectAll()
    .orderBy('priority', 'desc')
    .orderBy('indexedAt', 'desc')
    .orderBy('cid', 'desc')
    .limit(params.limit)

  if (params.cursor) {
    const cursor = decodeCursor(params.cursor)
    builder = builder.where(({ eb, or, and }) =>
      or([
        eb('post.priority', '<', cursor.priority),
        and([
          eb('post.priority', '=', cursor.priority),
          eb('post.indexedAt', '<', cursor.indexedAt),
        ]),
        and([
          eb('post.priority', '=', cursor.priority),
          eb('post.indexedAt', '=', cursor.indexedAt),
          eb('post.cid', '<', cursor.cid),
        ]),
      ]),
    )
  }
  const res = await builder.execute()

  const feed = res.map((row) => ({
    post: row.uri,
  }))

  let cursor: string | undefined
  const last = res.at(-1)
  if (last) {
    cursor = encodeCursor({
      priority: last.priority ?? 0,
      indexedAt: last.indexedAt,
      cid: last.cid,
    })
  }

  return {
    cursor,
    feed,
  }
}

type CursorState = {
  priority: number
  indexedAt: string
  cid: string
}

const cursorDelimiter = '::'

const encodeCursor = (cursor: CursorState): string =>
  [
    cursor.priority.toString(10),
    cursor.indexedAt,
    cursor.cid,
  ].join(cursorDelimiter)

const decodeCursor = (cursor: string): CursorState => {
  const [priority, indexedAt, cid] = cursor.split(cursorDelimiter)
  return {
    priority: Number(priority) || 0,
    indexedAt,
    cid,
  }
}
