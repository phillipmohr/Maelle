/**
 * Error types and the one place that formats errors for the UI: plain words, then the provider
 * detail, then what did not happen, then the request id.
 *
 *   Stripe: rate_limit (429) · nothing was charged or refunded · req_Qx91Lm
 *   Not the latest payment: ch_3Qz… from Sep 20 is newer · nothing was charged or refunded
 */

export type Provider = 'Stripe' | 'Linear' | 'InstaRadar' | 'Supabase' | 'Mail' | 'Maelle'

/** An external system answered with an error. Thrown by the real adapters and the fakes alike. */
export class ProviderError extends Error {
  readonly provider: Provider
  readonly code: string | null
  readonly statusCode: number | null
  readonly requestId: string | null
  /** True when a retry with the same idempotency key can succeed (rate limit, network, 5xx). */
  readonly retryable: boolean

  constructor(
    provider: Provider,
    message: string,
    opts: {
      code?: string | null
      statusCode?: number | null
      requestId?: string | null
      retryable?: boolean
      cause?: unknown
    } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'ProviderError'
    this.provider = provider
    this.code = opts.code ?? null
    this.statusCode = opts.statusCode ?? null
    this.requestId = opts.requestId ?? null
    this.retryable = opts.retryable ?? false
  }
}

/** A live-data check failed before anything was written. Plain words for the UI. */
export class PreconditionError extends Error {
  readonly detail: Record<string, unknown>
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'PreconditionError'
    this.detail = detail
  }
}

/** A decision-API error with an HTTP status, thrown by the service and mapped by the routes. */
export class ExecutorError extends Error {
  readonly statusCode: number
  readonly data: Record<string, unknown> | undefined
  constructor(statusCode: number, message: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'ExecutorError'
    this.statusCode = statusCode
    this.data = data
  }
}

/** Never let an em dash reach a customer; the UI shows these strings as well. */
function noEmDash(s: string): string {
  return s.replace(/[—―]/g, '·')
}

export interface FormattedError {
  /** The string stored in `action_executions.error` and shown in the UI. */
  message: string
  /** Request ids and codes worth keeping next to the row. */
  externalRefs: Record<string, string>
  retryable: boolean
}

/**
 * Formats any error thrown while running an action. `consequence` is the handler's "what did not
 * happen" text, e.g. "nothing was charged or refunded".
 */
export function formatActionError(err: unknown, consequence: string): FormattedError {
  if (err instanceof ProviderError) {
    const parts: string[] = []
    const detail = err.code ? `${err.code}${err.message ? `: ${err.message}` : ''}` : err.message
    parts.push(`${err.provider}: ${detail}${err.statusCode ? ` (${err.statusCode})` : ''}`)
    parts.push(consequence)
    if (err.requestId) parts.push(err.requestId)
    const externalRefs: Record<string, string> = {}
    if (err.requestId) externalRefs.requestId = err.requestId
    if (err.code) externalRefs.errorCode = err.code
    return { message: noEmDash(parts.join(' · ')), externalRefs, retryable: err.retryable }
  }
  if (err instanceof PreconditionError) {
    return {
      message: noEmDash(`${err.message} · ${consequence}`),
      externalRefs: {},
      retryable: false,
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return {
    message: noEmDash(`Executor: ${message} · ${consequence}`),
    externalRefs: {},
    retryable: false,
  }
}

// ---------------------------------------------------------------- provider error adapters

interface StripeLikeError {
  type?: string
  rawType?: string
  code?: string
  statusCode?: number
  requestId?: string
  message?: string
}

/** Stripe SDK error → ProviderError. Rate limits, connection problems and 5xx are retryable. */
export function fromStripeError(err: unknown): ProviderError {
  const e = (err ?? {}) as StripeLikeError
  const status = typeof e.statusCode === 'number' ? e.statusCode : null
  const code = e.code ?? e.rawType ?? (e.type ? e.type.replace(/^Stripe|Error$/g, '') : null)
  const retryable =
    e.type === 'StripeRateLimitError' ||
    e.type === 'StripeConnectionError' ||
    e.type === 'StripeAPIError' ||
    (status !== null && (status === 429 || status >= 500))
  return new ProviderError('Stripe', e.message ?? 'request failed', {
    code: code ? code.toLowerCase() : null,
    statusCode: status,
    requestId: e.requestId ?? null,
    retryable,
    cause: err,
  })
}

interface LinearLikeError {
  type?: string
  status?: number
  message?: string
  errors?: { message?: string }[]
}

export function fromLinearError(err: unknown): ProviderError {
  const e = (err ?? {}) as LinearLikeError
  const first = e.errors?.[0]?.message
  const status = typeof e.status === 'number' ? e.status : null
  const retryable =
    e.type === 'Ratelimited' ||
    e.type === 'NetworkError' ||
    e.type === 'InternalError' ||
    e.type === 'LockTimeout' ||
    (status !== null && (status === 429 || status >= 500))
  return new ProviderError('Linear', first ?? e.message ?? 'request failed', {
    code: e.type ?? null,
    statusCode: status,
    retryable,
    cause: err,
  })
}

interface PgLikeError {
  code?: string
  message?: string
  detail?: string
}

/** Postgres (pg) error → ProviderError; connection and lock problems are retryable. */
export function fromPgError(provider: Provider, err: unknown): ProviderError {
  const e = (err ?? {}) as PgLikeError
  const code = e.code ?? null
  const retryable =
    code === null ||
    code.startsWith('08') || // connection
    code === '40001' || // serialization
    code === '40P01' || // deadlock
    code === '55P03' || // lock not available
    code === '57014' // statement timeout
  return new ProviderError(provider, e.message ?? 'database error', {
    code,
    retryable,
    cause: err,
  })
}
