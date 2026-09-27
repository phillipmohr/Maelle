/**
 * Inbound classification (IRDR-455): what never becomes a ticket. Auto-replies (RFC 3834
 * Auto-Submitted, Precedence, X-Autoreply), bounces (mailer-daemon, delivery-status reports,
 * empty Return-Path), bulk mail and mail we sent ourselves.
 */
import type { ParsedMail } from './parse'

export type IgnoreReason = 'no_sender' | 'own' | 'bounce' | 'auto_reply' | 'bulk'

export type Classification =
  { kind: 'customer' } | { kind: 'ignore'; reason: IgnoreReason; detail: string }

const AUTO_REPLY_SUBJECT =
  /^\s*(automatic reply|automatische antwort|auto(matic)?[- ]?reply|autoreply|auto[- ]?response|réponse automatique|respuesta automática|risposta automatica|out of (the )?office|abwesenheitsnotiz|abwesenheit)/i
const BOUNCE_SUBJECT =
  /^\s*(undeliver(able|ed)|delivery (status notification|failure|has failed)|mail delivery failed|returned mail|failure notice|unzustellbar)/i
const DAEMON_SENDER = /^(mailer-daemon|postmaster|no-?reply-bounces|bounces?)[@+.-]/i

export function classifyInbound(mail: ParsedMail, opts: { mailbox: string }): Classification {
  const from = mail.from?.address ?? ''
  if (!from) return { kind: 'ignore', reason: 'no_sender', detail: 'no From address' }

  if (from === opts.mailbox.toLowerCase()) {
    return { kind: 'ignore', reason: 'own', detail: `sent by ${opts.mailbox}` }
  }

  const h = mail.headers
  const returnPath = (h['return-path'] ?? '').trim()
  if (
    DAEMON_SENDER.test(from) ||
    (mail.contentType === 'multipart/report' && mail.reportType === 'delivery-status') ||
    h['x-failed-recipients'] ||
    returnPath === '<>' ||
    BOUNCE_SUBJECT.test(mail.subject ?? '')
  ) {
    return { kind: 'ignore', reason: 'bounce', detail: `bounce from ${from}` }
  }

  const autoSubmitted = (h['auto-submitted'] ?? '').trim().toLowerCase()
  const precedence = (h.precedence ?? '').trim().toLowerCase()
  if (
    (autoSubmitted && autoSubmitted !== 'no') ||
    precedence === 'auto_reply' ||
    h['x-autoreply'] != null ||
    h['x-autorespond'] != null ||
    AUTO_REPLY_SUBJECT.test(mail.subject ?? '')
  ) {
    return {
      kind: 'ignore',
      reason: 'auto_reply',
      detail: autoSubmitted ? `Auto-Submitted: ${autoSubmitted}` : 'auto-reply headers or subject',
    }
  }

  if (
    precedence === 'bulk' ||
    precedence === 'junk' ||
    precedence === 'list' ||
    h['list-id'] != null ||
    h['list-unsubscribe'] != null
  ) {
    return {
      kind: 'ignore',
      reason: 'bulk',
      detail: precedence ? `Precedence: ${precedence}` : 'list headers',
    }
  }

  return { kind: 'customer' }
}
