/**
 * The chargeback evidence attachment: a Stripe activity timeline rendered deterministically as SVG
 * from the customer's Stripe objects. No browser, no fonts to load, no randomness: the same input
 * always yields the same bytes. A pure JS SVG→PNG converter without native dependencies is not
 * installed, so the SVG itself is attached (see README).
 */
import type { StripeCustomerBundle } from '../types'

export interface TimelineRow {
  /** ISO timestamp. */
  at: string
  label: string
  amount: string | null
  id: string
  kind: 'default' | 'bad' | 'muted'
}

export function money(cents: number, currency: string): string {
  const symbol =
    currency.toLowerCase() === 'usd'
      ? '$'
      : currency.toLowerCase() === 'eur'
        ? '€'
        : `${currency.toUpperCase()} `
  return `${symbol}${(cents / 100).toFixed(2)}`
}

/** Builds the timeline rows from a Stripe bundle. Sorted by time, oldest first. */
export function buildStripeTimeline(bundle: StripeCustomerBundle): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const s of bundle.subscriptions) {
    rows.push({
      at: s.created,
      label: `Subscribed · ${s.plan}`,
      amount: s.amountCents != null ? money(s.amountCents, s.currency) : null,
      id: s.id,
      kind: 'default',
    })
    if (s.canceledAt || s.endedAt) {
      rows.push({
        at: s.endedAt ?? s.canceledAt!,
        label: s.cancelAtPeriodEnd && !s.endedAt ? 'Cancellation scheduled' : 'Cancelled',
        amount: null,
        id: s.id,
        kind: 'muted',
      })
    }
  }
  for (const c of bundle.charges) {
    if (c.status === 'failed') {
      rows.push({
        at: c.created,
        label: `Payment failed${c.failureMessage ? ` · ${c.failureMessage}` : ''}`,
        amount: money(c.amountCents, c.currency),
        id: c.id,
        kind: 'muted',
      })
      continue
    }
    rows.push({
      at: c.created,
      label: c.disputed ? 'Charge · disputed' : 'Payment',
      amount: money(c.amountCents, c.currency),
      id: c.id,
      kind: c.disputed ? 'bad' : 'default',
    })
  }
  for (const r of bundle.refunds) {
    rows.push({
      at: r.created,
      label: 'Refund',
      amount: `-${money(r.amountCents, r.currency)}`,
      id: r.id,
      kind: 'muted',
    })
  }
  for (const d of bundle.disputes) {
    rows.push({
      at: d.created,
      label: `Dispute opened${d.reason ? ` · ${d.reason}` : ''}`,
      amount: money(d.amountCents, d.currency),
      id: d.id,
      kind: 'bad',
    })
  }
  // Same instant: the subscription comes before its first charge, a cancellation after payments.
  const rank = (r: TimelineRow) =>
    r.label.startsWith('Subscribed') ? 0 : r.label.startsWith('Cancel') ? 2 : 1
  return rows.sort(
    (a, b) => a.at.localeCompare(b.at) || rank(a) - rank(b) || a.id.localeCompare(b.id),
  )
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export interface TimelineSvgInput {
  title: string
  subtitle: string
  rows: TimelineRow[]
  /** Printed in the footer. Pass a fixed value for reproducible output. */
  generatedAt: string
}

export function renderStripeTimelineSvg(input: TimelineSvgInput): string {
  const width = 920
  const rowH = 34
  const top = 96
  const rows = input.rows.slice(0, 60)
  const height = top + rows.length * rowH + 64
  const colors = { default: '#1c140c', bad: '#b3261e', muted: '#7a6f63' }
  const lines = rows.map((r, i) => {
    const y = top + i * rowH
    const color = colors[r.kind]
    return [
      `<rect x="24" y="${y - 22}" width="${width - 48}" height="${rowH}" fill="${i % 2 ? '#faf7f1' : '#ffffff'}"/>`,
      `<text x="40" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${color}">${esc(fmtDate(r.at))}</text>`,
      `<text x="180" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${color}"${r.kind === 'bad' ? ' font-weight="bold"' : ''}>${esc(r.label)}</text>`,
      `<text x="640" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${color}" text-anchor="end">${esc(r.amount ?? '')}</text>`,
      `<text x="${width - 40}" y="${y}" font-family="Menlo, Consolas, monospace" font-size="12" fill="#7a6f63" text-anchor="end">${esc(r.id)}</text>`,
    ].join('')
  })
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="40" y="44" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="bold" fill="#1c140c">${esc(input.title)}</text>`,
    `<text x="40" y="68" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#7a6f63">${esc(input.subtitle)}</text>`,
    `<line x1="24" y1="${top - 24}" x2="${width - 24}" y2="${top - 24}" stroke="#d9d2c5" stroke-width="1"/>`,
    ...lines,
    `<text x="40" y="${height - 24}" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#7a6f63">Stripe activity timeline · generated by InstaRadar Customer Care on ${esc(fmtDate(input.generatedAt))} · all times UTC</text>`,
    `</svg>`,
  ].join('\n')
}
