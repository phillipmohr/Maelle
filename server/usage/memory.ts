/** In-memory usage sink for unit tests, evals and the offline mode. Rows are kept in insertion order. */
import type { ModelCallRow, ToolCallRow } from '#shared/api'
import type { UsageSink } from './types'

export interface MemoryUsageSink extends UsageSink {
  readonly kind: 'memory'
  readonly modelCalls: ModelCallRow[]
  readonly toolCalls: ToolCallRow[]
}

export function createMemoryUsageSink(now: () => Date = () => new Date()): MemoryUsageSink {
  const modelCalls: ModelCallRow[] = []
  const toolCalls: ToolCallRow[] = []
  return {
    kind: 'memory',
    modelCalls,
    toolCalls,
    async recordModelCall(call) {
      modelCalls.push({ ...call, createdAt: call.createdAt ?? now().toISOString() })
    },
    async recordToolCalls(calls) {
      for (const c of calls) toolCalls.push({ ...c, createdAt: c.createdAt ?? now().toISOString() })
    },
    async setToolContextTokens(updates) {
      for (const u of updates) {
        const row = toolCalls.find((t) => t.id === u.id)
        if (row) {
          row.contextTokens = u.contextTokens
          row.contextMeasured = true
        }
      }
    },
  }
}
