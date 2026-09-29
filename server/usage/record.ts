/**
 * `trackModelCall` wraps one Claude call: it times it, reads `response.usage`, prices it and writes
 * one `model_calls` row through the sink, for successes, refusals and errors alike. The response is
 * returned unchanged and errors are rethrown; a failing sink only logs.
 */
import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import type { ModelCallPurpose } from '#shared/api'
import { costUsd, usageFromApi, ZERO_USAGE } from '#shared/pricing'
import type { UsageSink } from './types'

export interface ModelCallMeta {
  /** Caller-provided id when other rows will point at this call (the loop's tool calls). */
  id?: string
  purpose: ModelCallPurpose
  model: string
  ticketId?: string | null
  runId?: string | null
  turn?: number | null
  attempt?: number | null
}

export function newCallId(): string {
  return randomUUID()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A ticket reference that can be stored in a uuid column, else null. */
export function ticketIdOrNull(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null
}

export async function trackModelCall(
  sink: UsageSink | null | undefined,
  meta: ModelCallMeta,
  call: () => Promise<Anthropic.Message>,
  log: (msg: string, data?: unknown) => void = () => {},
): Promise<Anthropic.Message> {
  const id = meta.id ?? newCallId()
  const started = Date.now()
  const base = {
    id,
    ticketId: meta.ticketId ?? null,
    runId: meta.runId ?? null,
    purpose: meta.purpose,
    turn: meta.turn ?? null,
    attempt: meta.attempt ?? null,
  }
  const record = async (row: Parameters<UsageSink['recordModelCall']>[0]) => {
    if (!sink) return
    try {
      await sink.recordModelCall(row)
    } catch (e) {
      log('usage: model call not recorded', e)
    }
  }
  let response: Anthropic.Message
  try {
    response = await call()
  } catch (e) {
    await record({
      ...base,
      model: meta.model,
      status: 'error',
      stopReason: null,
      error: (e as Error).message?.slice(0, 500) ?? 'unknown error',
      ...ZERO_USAGE,
      // nothing was billed, so the cost is known: zero
      costUsd: 0,
      durationMs: Date.now() - started,
    })
    throw e
  }
  const usage = usageFromApi(response.usage)
  const model = response.model || meta.model
  await record({
    ...base,
    model,
    status: response.stop_reason === 'refusal' ? 'refusal' : 'ok',
    stopReason: response.stop_reason ?? null,
    error: null,
    ...usage,
    costUsd: costUsd(model, usage),
    durationMs: Date.now() - started,
  })
  return response
}
