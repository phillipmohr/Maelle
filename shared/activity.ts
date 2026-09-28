/**
 * Activity log formatting (IRDR-459), shared by the UI table and the CSV export: one line of
 * parameters per action in the voice of the design ("$13.07 · Visa ··5521 · retry",
 * "access until Oct 26", "INS-215 · “Date and time in file names”").
 */
import type { ActionExecutionRow, ExecutionStatus } from './api'

type Params = Record<string, unknown>

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function moneyLabel(cents: unknown, currency: unknown): string | null {
  if (typeof cents !== 'number') return null
  const cur = typeof currency === 'string' && currency.length === 3 ? currency : 'usd'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(
    cents / 100,
  )
}

function dateLabel(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function join(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ')
}

/** The Parameters column. */
export function describeExecution(
  e: Pick<ActionExecutionRow, 'type' | 'params'> &
    Partial<Pick<ActionExecutionRow, 'result' | 'externalRefs'>>,
): string {
  const p = (e.params ?? {}) as Params
  const result = (e.result ?? {}) as Params
  const refs = (e.externalRefs ?? {}) as Record<string, string>
  const note = str(p.note)
  switch (e.type) {
    case 'send_reply':
      return join([p.to ? `to ${String(p.to)}` : null, note])
    case 'create_linear_ticket': {
      const issue = refs.linearIssue ?? str(result.identifier) ?? str(p.existingIssueIdentifier)
      const title = str(p.title)
      const linked =
        result.linked === true || (p.existingIssueIdentifier && !title) ? 'linked' : null
      return join([issue, title ? `“${title}”` : null, linked, note])
    }
    case 'store_release_notification_email':
      return join([str(p.linearIssueIdentifier), str(p.email), note])
    case 'store_cancellation_reason': {
      const comment = str(p.comment)
      return join([comment ? `“${comment}”` : null, str(p.feedback), note])
    }
    case 'cancel_at_period_end': {
      const until = dateLabel(result.accessUntil ?? p.accessUntil)
      return join([until ? `access until ${until}` : str(p.stripeSubscriptionId), note])
    }
    case 'cancel_immediately': {
      const n = (result.deletedProfiles ?? p.profilesAffected) as unknown
      return join([
        typeof n === 'number'
          ? `deleted ${n} profile${n === 1 ? '' : 's'}`
          : str(p.stripeSubscriptionId),
        note,
      ])
    }
    case 'refund_latest_payment':
      return join([moneyLabel(p.amountCents, p.currency), str(p.cardLabel), note])
    case 'stop_failed_payment_retries': {
      const invoices = Array.isArray(p.stripeInvoiceIds) ? p.stripeInvoiceIds.length : 0
      return join([
        invoices > 0 ? `${invoices} invoice${invoices === 1 ? '' : 's'}` : str(p.stripeCustomerId),
        note,
      ])
    }
    case 'create_coupon': {
      const off =
        p.kind === 'percent' && typeof p.percentOff === 'number'
          ? `${p.percentOff}% off`
          : moneyLabel(p.amountOffCents, p.currency)
      return join([off ? `${off}` : null, str(p.duration), str(refs.stripeCoupon), note])
    }
    case 'delete_account':
      return join([str(p.email), note])
    case 'remove_from_tracking':
      return join([
        p.instagramHandle ? `@${String(p.instagramHandle).replace(/^@/, '')}` : null,
        note,
      ])
    default:
      return join(Object.values(p).map(str))
  }
}

export type ResultTone = 'success' | 'error' | 'warning' | 'info' | 'neutral'

/** The Result pill: tone and label per execution status. */
export function executionResultLabel(e: Pick<ActionExecutionRow, 'type' | 'status'>): {
  tone: ResultTone
  label: string
} {
  const s: ExecutionStatus = e.status
  switch (s) {
    case 'succeeded':
      return { tone: 'success', label: e.type === 'send_reply' ? 'Sent' : 'Succeeded' }
    case 'failed':
      return { tone: 'error', label: 'Failed' }
    case 'held':
      return { tone: 'warning', label: 'Held' }
    case 'scheduled':
      return { tone: 'info', label: 'Scheduled' }
    case 'queued':
      return { tone: 'info', label: 'Queued' }
    case 'running':
      return { tone: 'info', label: 'Running' }
    case 'cancelled':
      return { tone: 'neutral', label: 'Undone' }
    default:
      return { tone: 'neutral', label: String(s) }
  }
}
