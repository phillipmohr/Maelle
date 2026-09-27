/**
 * Idempotency keys. The base key is `executionIdempotencyKey(ticketId, proposalVersion, position)`
 * from shared/utils/ids. A retry writes a new `action_executions` row with `attempt + 1` and the
 * suffix `:a<attempt>` (as the seed does), but every external call reuses the BASE key, so Stripe,
 * Linear and mail see the same request twice and never duplicate a side effect.
 */
import { executionIdempotencyKey } from '#shared/utils/ids'

export { executionIdempotencyKey }

/** Key for a manual send: no proposal, so the decision id scopes it. */
export function manualIdempotencyKey(ticketId: string, decisionId: string, position: number) {
  return `${ticketId}:m${decisionId}:p${position}`
}

const ATTEMPT_RE = /:a(\d+)$/
const POSITION_RE = /:p(\d+)(?::a\d+)?$/

export function attemptKey(baseKey: string, attempt: number): string {
  return attempt <= 1 ? baseKey : `${baseKey}:a${attempt}`
}

export function baseKeyOf(key: string): string {
  return key.replace(ATTEMPT_RE, '')
}

export function attemptOf(key: string): number {
  const m = ATTEMPT_RE.exec(key)
  return m ? Number(m[1]) : 1
}

export function positionOf(key: string): number {
  const m = POSITION_RE.exec(key)
  return m ? Number(m[1]) : 0
}
