/**
 * Plain-text emails in Maelle's voice. No HTML, no em dashes. Everything a reader needs is in the
 * first lines; the link comes last.
 */
import type { NotifyPayloads } from '#shared/services'
import { actionLabel } from '#shared/actions'
import { caseShortLabel } from '#shared/case-types'
import type { DigestData } from './digest'

export interface RenderedMail {
  subject: string
  body: string
}

/** "Sep 27, 08:00" in the given timezone. */
export function dateTimeLabel(iso: string, timeZone = 'Europe/Berlin'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    })
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** "Oct 7" for ISO dates. */
export function dateLabel(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function who(name: string | null, email: string): string {
  return name ? `${name} <${email}>` : email
}

export function renderHighRiskAlert(p: NotifyPayloads['high_risk_ticket']): RenderedMail {
  const label = p.riskLevel === 'safety' ? 'Safety' : 'High risk'
  const caseLabel = caseShortLabel(p.caseType)
  const lines = [
    `${label} ticket #${p.displayNumber} needs your decision.`,
    '',
    `Who: ${who(p.customerName, p.customerEmail)}`,
    `Case: ${caseLabel}`,
    `Risk: ${label}`,
  ]
  if (p.dueDate) lines.push(`Due: ${dateLabel(p.dueDate)}`)
  lines.push('', `Open it: ${p.url}`, '', 'Nothing runs on this ticket until you decide.')
  return {
    subject: `[Maelle] ${label} · #${p.displayNumber} ${p.customerName ?? p.customerEmail} · ${caseLabel}`,
    body: lines.join('\n'),
  }
}

export function renderSystemAlert(
  p: NotifyPayloads['system_alert'],
  now: Date = new Date(),
): RenderedMail {
  return {
    subject: `[Maelle] Alert · ${p.title}`,
    body: [p.title, '', p.detail, '', `Source: ${p.source}`, `Time: ${now.toISOString()}`].join(
      '\n',
    ),
  }
}

function section(title: string, lines: string[]): string[] {
  return [`${title} (${lines.length})`, ...(lines.length ? lines.map((l) => `  ${l}`) : ['  none'])]
}

export function renderDigest(d: DigestData): RenderedMail {
  const tz = d.timezone
  const name = (t: { customerName: string | null; customerEmail: string }) =>
    t.customerName ?? t.customerEmail
  const caseOf = (c: DigestData['autoHandled'][number]['caseType']) =>
    c ? caseShortLabel(c) : 'Unclassified'

  const auto = d.autoHandled.map((t) =>
    [
      `#${t.displayNumber} ${name(t)}`,
      caseOf(t.caseType),
      t.ran.length ? t.ran.map(actionLabel).join(', ') : 'nothing ran',
      dateTimeLabel(t.at, tz),
    ].join(' · '),
  )
  const needs = d.needsDecision.map((t) =>
    [
      `#${t.displayNumber} ${name(t)}`,
      caseOf(t.caseType),
      t.status === 'action_failed'
        ? 'action failed'
        : t.riskLevel === 'safety'
          ? 'safety'
          : t.riskLevel === 'high'
            ? 'high risk'
            : 'needs decision',
      t.dueDate ? `due ${dateLabel(t.dueDate)}` : `since ${dateTimeLabel(t.at, tz)}`,
    ].join(' · '),
  )
  const waiting = d.waiting.map((t) =>
    [
      `#${t.displayNumber} ${name(t)}`,
      caseOf(t.caseType),
      t.status === 'snoozed'
        ? `snoozed until ${t.snoozedUntil ? dateTimeLabel(t.snoozedUntil, tz) : 'later'}`
        : t.status === 'auto_pending'
          ? 'Auto · inside the undo window'
          : `waiting on customer since ${dateTimeLabel(t.at, tz)}`,
    ].join(' · '),
  )
  const failures = d.failures.map((f) =>
    [
      `#${f.displayNumber} ${f.customerName ?? ''}`.trim(),
      actionLabel(f.action),
      f.error ?? 'failed',
      dateTimeLabel(f.at, tz),
    ].join(' · '),
  )

  const body = [
    `AnastasAI daily digest · ${dateTimeLabel(d.until, tz)}`,
    `Since ${dateTimeLabel(d.since, tz)}.`,
    '',
    ...section('Handled automatically', auto),
    '',
    ...section('Needs your decision', needs),
    '',
    ...section('Waiting', waiting),
    '',
    ...section('Failed actions', failures),
    '',
    `Open the inbox: ${d.siteUrl.replace(/\/$/, '')}/anastasai`,
  ].join('\n')

  return {
    subject: `[Maelle] Daily digest · ${d.needsDecision.length} need a decision · ${d.autoHandled.length} handled automatically`,
    body,
  }
}
