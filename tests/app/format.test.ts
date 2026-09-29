import { describe, expect, it } from 'vitest'
import {
  ageShort,
  dayLabel,
  duration,
  formatCost,
  formatTokens,
  money,
  percent,
  plural,
  shortDate,
} from '../../app/utils/format'

const now = new Date('2026-09-27T10:00:00Z')

describe('format helpers', () => {
  it('ageShort', () => {
    expect(ageShort(new Date('2026-09-27T09:56:00Z'), now)).toBe('4m')
    expect(ageShort(new Date('2026-09-27T07:00:00Z'), now)).toBe('3h')
    expect(ageShort(new Date('2026-09-26T09:00:00Z'), now)).toBe('1d')
    expect(ageShort(new Date('2026-09-10T09:00:00Z'), now)).toBe('2w')
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    expect(ageShort(tomorrow, now)).toBe('Tmrw')
    expect(ageShort(null, now)).toBe('')
  })

  it('shortDate and dayLabel', () => {
    expect(shortDate('2026-10-07T00:00:00Z', now)).toMatch(/Oct 7/)
    expect(dayLabel(now, now)).toBe('Today')
    expect(dayLabel(new Date(now.getTime() - 86_400_000), now)).toBe('Yesterday')
  })

  it('money and plural', () => {
    expect(money(1307)).toBe('$13.07')
    expect(plural(1, 'action')).toBe('1 action')
    expect(plural(3, 'action')).toBe('3 actions')
  })

  it('cost, tokens, duration and percent (IRDR-460)', () => {
    expect(formatCost(0.4189)).toBe('$0.42')
    expect(formatCost(0.0044)).toBe('$0.004')
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(null)).toBe('–')
    expect(formatCost(1234.5, { compact: true })).toBe('$1.2K')
    expect(formatTokens(18400)).toBe('18,400')
    expect(formatTokens(18400, { compact: true })).toBe('18K')
    expect(formatTokens(1840, { compact: true })).toBe('1.8K')
    expect(formatTokens(2_400_000, { compact: true })).toBe('2.4M')
    expect(formatTokens(null)).toBe('–')
    expect(duration(640)).toBe('0.6s')
    expect(duration(22_000)).toBe('22s')
    expect(duration(65_000)).toBe('1m 05s')
    expect(percent(0.126)).toBe('13%')
    expect(percent(null)).toBe('–')
  })
})
