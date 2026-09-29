/**
 * Where token usage goes. One row per Claude call (`model_calls`) and one per tool call inside the
 * agent loop (`agent_tool_calls`). Two implementations: Postgres and memory (tests, evals, the
 * seed-backed offline mode). Recording is best effort: a sink error is logged, never thrown into
 * the call it describes.
 */
import type { ModelCallRow, ToolCallRow } from '#shared/api'

export type ModelCallRecord = Omit<ModelCallRow, 'createdAt'> & { createdAt?: string }
export type ToolCallRecord = Omit<ToolCallRow, 'createdAt'> & { createdAt?: string }

export interface ToolContextUpdate {
  id: string
  contextTokens: number
}

export interface UsageSink {
  readonly kind: 'db' | 'memory'
  recordModelCall(call: ModelCallRecord): Promise<void>
  recordToolCalls(calls: ToolCallRecord[]): Promise<void>
  /** The measured context share of the next turn replaces the estimate written at insert time. */
  setToolContextTokens(updates: ToolContextUpdate[]): Promise<void>
}
