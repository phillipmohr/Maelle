import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_COUNTS,
  countByStatus,
  loadPlaybookCounts,
  resetPlaybookCountsCache,
} from '../../server/learning/notion-counts'

type Page = Awaited<ReturnType<Parameters<typeof countByStatus>[0]>>

function page(statuses: (string | null)[], next: string | null): Page {
  return {
    object: 'list',
    type: 'page_or_data_source',
    page_or_data_source: {},
    has_more: next !== null,
    next_cursor: next,
    results: statuses.map(
      (s, i) =>
        ({
          object: 'page',
          id: `p${i}`,
          properties: {
            Status: s ? { type: 'select', select: { name: s } } : { type: 'select', select: null },
          },
        }) as unknown as Page['results'][number],
    ),
  }
}

describe('playbook counts', () => {
  it('counts Active and Draft across pages', async () => {
    const pages = [page(['Active', 'Active', 'Draft'], 'c2'), page(['Active', null], null)]
    let i = 0
    const counts = await countByStatus(async () => pages[i++]!)
    expect(counts).toEqual({ total: 5, active: 3, draft: 1 })
  })

  it('uses the snapshot without a token and after a failure', async () => {
    resetPlaybookCountsCache()
    expect(await loadPlaybookCounts(undefined)).toBe(SNAPSHOT_COUNTS)
    const failing = await loadPlaybookCounts('secret', {
      fetch: async () => {
        throw new Error('401')
      },
    })
    expect(failing.live).toBe(false)
    const live = await loadPlaybookCounts('secret', {
      fetch: async () => ({
        examples: { total: 12, active: 10, draft: 2 },
        knowledgeBase: { total: 1, active: 0, draft: 1 },
        live: true,
      }),
      now: () => 1_000,
    })
    expect(live.examples.draft).toBe(2)
    // cached for five minutes
    const cached = await loadPlaybookCounts('secret', {
      fetch: async () => {
        throw new Error('should not be called')
      },
      now: () => 2_000,
    })
    expect(cached).toBe(live)
    resetPlaybookCountsCache()
  })
})
