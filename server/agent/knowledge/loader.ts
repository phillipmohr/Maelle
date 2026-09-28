/**
 * Knowledge loader: Notion at runtime (NOTION_TOKEN) with an in-process cache of a few minutes,
 * the docs/notion snapshot when the token is missing or Notion fails. No sync, no embeddings, no
 * staleness tracking: the knowledge base is small and read whole.
 */
import type { NotionReadClient } from '../types'
import { loadKnowledgeFromNotion } from './notion'
import { loadSnapshotKnowledge } from './snapshot'
import type { Knowledge } from './types'

export interface KnowledgeLoader {
  load(opts?: { force?: boolean }): Promise<Knowledge>
  /** Tests: drop the cache. */
  reset(): void
}

export function createKnowledgeLoader(deps: {
  notion: NotionReadClient | null
  ttlMs?: number
  now?: () => Date
  snapshot?: () => Promise<Knowledge>
}): KnowledgeLoader {
  const ttl = deps.ttlMs ?? 5 * 60_000
  const now = deps.now ?? (() => new Date())
  const snapshot = deps.snapshot ?? loadSnapshotKnowledge
  let cached: { at: number; value: Knowledge } | null = null
  let inflight: Promise<Knowledge> | null = null

  async function fetchFresh(): Promise<Knowledge> {
    const notion = deps.notion
    if (!notion?.configured) {
      const k = await snapshot()
      return {
        ...k,
        warnings: [...k.warnings, 'No Notion token (NOTION_TOKEN), using the docs/notion snapshot'],
      }
    }
    try {
      return await loadKnowledgeFromNotion(notion, now())
    } catch (e) {
      const k = await snapshot()
      return {
        ...k,
        warnings: [
          ...k.warnings,
          `Notion unavailable (${(e as Error).message}), using the docs/notion snapshot`,
        ],
      }
    }
  }

  return {
    async load(opts) {
      const t = now().getTime()
      if (!opts?.force && cached && t - cached.at < ttl) return cached.value
      if (!inflight) {
        inflight = fetchFresh()
          .then((value) => {
            cached = { at: now().getTime(), value }
            return value
          })
          .finally(() => {
            inflight = null
          })
      }
      return inflight
    },
    reset() {
      cached = null
    },
  }
}
