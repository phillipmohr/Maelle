/**
 * POST /api/agent/consistency-check — owner: IRDR-456. Foundation stub: a few deterministic checks
 * (reply mentions a refund but the refund action is off, and the reverse) so the UI can wire it up.
 */
import type { ConsistencyCheckRequest, ConsistencyCheckResponse } from '#shared/api'
import { EM_DASH_RE } from '#shared/proposal'
import { stubHeaders } from '../../utils/stubs'

export default defineEventHandler(async (event): Promise<ConsistencyCheckResponse> => {
  stubHeaders(event, 'IRDR-456')
  const body = await readBody<ConsistencyCheckRequest>(event)
  const text = (body?.replyBody ?? '').toLowerCase()
  const enabled = new Set<string>((body?.enabledActions ?? []).map((a) => a.type))
  const mismatches: ConsistencyCheckResponse['mismatches'] = []
  const pairs: { word: RegExp; action: string; label: string }[] = [
    { word: /refund/, action: 'refund_latest_payment', label: 'a refund' },
    { word: /cancel/, action: 'cancel_at_period_end', label: 'a cancellation' },
    { word: /coupon|discount|free month/, action: 'create_coupon', label: 'a coupon' },
    {
      word: /let you know|email you|notify you|as soon as it's live|when it's live/,
      action: 'store_release_notification_email',
      label: 'a release notice',
    },
  ]
  for (const p of pairs) {
    const mentioned = p.word.test(text)
    const on =
      enabled.has(p.action) ||
      (p.action === 'cancel_at_period_end' && enabled.has('cancel_immediately'))
    if (mentioned && !on)
      mismatches.push({
        severity: 'error',
        text: `The reply mentions ${p.label} but the matching action is off.`,
      })
    if (!mentioned && on && p.action !== 'store_release_notification_email') {
      mismatches.push({
        severity: 'warning',
        text: `${p.label[0]!.toUpperCase()}${p.label.slice(1)} will run but the reply does not mention it.`,
      })
    }
  }
  if (EM_DASH_RE.test(body?.replyBody ?? ''))
    mismatches.push({ severity: 'error', text: 'The reply contains an em dash.' })
  return { mismatches }
})
