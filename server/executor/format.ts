/** Small formatting helpers for results and error texts. No em dashes anywhere. */

export function formatMoney(cents: number, currency = 'usd'): string {
  const amount = (cents / 100).toFixed(2)
  const c = currency.toLowerCase()
  if (c === 'usd') return `$${amount}`
  if (c === 'eur') return `€${amount}`
  if (c === 'gbp') return `£${amount}`
  return `${amount} ${currency.toUpperCase()}`
}

/** Unix seconds → "2026-10-14". */
export function isoDateFromUnix(seconds: number | null | undefined): string | null {
  if (seconds == null) return null
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** "2026-09-20" → "Sep 20" (for error texts). */
export function shortDate(iso: string | null): string {
  if (!iso) return 'unknown date'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
