/** Formatting helpers in the design's voice: "4m", "3h", "1d", "Tmrw", "Oct 7", "09:00". */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact age for lists: 4m · 3h · 1d · 2w. Future dates: "Tmrw" when tomorrow, else the date. */
export function ageShort(input: string | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return ''
  const d = typeof input === 'string' ? new Date(input) : input
  const diff = now.getTime() - d.getTime()
  if (diff < 0) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (d.toDateString() === tomorrow.toDateString()) return 'Tmrw'
    return shortDate(d)
  }
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 14 * DAY) return `${Math.floor(diff / DAY)}d`
  if (diff < 60 * DAY) return `${Math.floor(diff / (7 * DAY))}w`
  return shortDate(d)
}

/** "Oct 7" (adds the year when it differs from the current one). */
export function shortDate(input: string | Date, now: Date = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

/** "09:00" */
export function clockTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** "Today", "Yesterday", "Sep 25" for day group headers. */
export function dayLabel(input: string | Date, now: Date = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input
  if (d.toDateString() === now.toDateString()) return 'Today'
  const y = new Date(now.getTime() - DAY)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return shortDate(d, now)
}

/** "$13.07" from cents. */
export function money(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/** "3 actions", "1 action" */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}
