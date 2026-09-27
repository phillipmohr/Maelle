/**
 * Live counts for the Playbook (Examples, Knowledge Base Active / Draft) through the Notion read
 * token, cached for five minutes. Snapshot counts when the token is missing or Notion fails.
 */
import { Client } from '@notionhq/client'
import { NOTION } from '#shared/case-types'

export interface StatusCounts {
  total: number
  active: number
  draft: number
}

export interface PlaybookCounts {
  examples: StatusCounts
  knowledgeBase: StatusCounts
  live: boolean
}

/** docs/notion snapshot of 2026-09-27: 10 examples (all Active), an empty Knowledge Base. */
export const SNAPSHOT_COUNTS: PlaybookCounts = {
  examples: { total: 10, active: 10, draft: 0 },
  knowledgeBase: { total: 0, active: 0, draft: 0 },
  live: false,
}

type QueryPage = Awaited<ReturnType<Client['dataSources']['query']>>

export async function countByStatus(
  query: (cursor: string | undefined) => Promise<QueryPage>,
): Promise<StatusCounts> {
  const counts: StatusCounts = { total: 0, active: 0, draft: 0 }
  let cursor: string | undefined
  for (let i = 0; i < 20; i++) {
    const page = await query(cursor)
    for (const row of page.results) {
      if (!('properties' in row) || row.object !== 'page') continue
      counts.total++
      const status = row.properties.Status
      const name = status && status.type === 'select' ? status.select?.name : undefined
      if (name === 'Active') counts.active++
      else if (name === 'Draft') counts.draft++
    }
    if (!page.has_more || !page.next_cursor) break
    cursor = page.next_cursor
  }
  return counts
}

export async function fetchPlaybookCounts(token: string): Promise<PlaybookCounts> {
  const client = new Client({ auth: token, timeoutMs: 10_000 })
  const count = (dataSourceId: string) =>
    countByStatus((cursor) =>
      client.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        start_cursor: cursor,
      }),
    )
  const [examples, knowledgeBase] = await Promise.all([
    count(NOTION.examplesCollectionId),
    count(NOTION.knowledgeBaseCollectionId),
  ])
  return { examples, knowledgeBase, live: true }
}

let cache: { at: number; counts: PlaybookCounts } | null = null
const TTL_MS = 5 * 60_000

export async function loadPlaybookCounts(
  token: string | undefined,
  opts: { fetch?: (token: string) => Promise<PlaybookCounts>; now?: () => number } = {},
): Promise<PlaybookCounts> {
  if (!token) return SNAPSHOT_COUNTS
  const now = opts.now?.() ?? Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.counts
  try {
    const counts = await (opts.fetch ?? fetchPlaybookCounts)(token)
    cache = { at: now, counts }
    return counts
  } catch (e) {
    console.warn(
      `[playbook] Notion counts unavailable (${(e as Error).message}), using the snapshot`,
    )
    return cache?.counts ?? SNAPSHOT_COUNTS
  }
}

/** Tests only. */
export function resetPlaybookCountsCache(): void {
  cache = null
}
