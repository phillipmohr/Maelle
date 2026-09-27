import { describe, expect, it } from 'vitest'
import { digestSlot, intervalSlot, localDateTime, timeToMinutes } from '../../server/jobs/schedule'

describe('recurring schedule slots', () => {
  it('buckets time into interval slots', () => {
    const now = new Date('2026-09-27T20:58:45.123Z')
    expect(intervalSlot(now, 60)).toBe('2026-09-27T20:58Z')
    expect(intervalSlot(now, 300)).toBe('2026-09-27T20:55Z')
    expect(intervalSlot(new Date('2026-09-27T20:59:59.999Z'), 60)).toBe('2026-09-27T20:59Z')
  })

  it('converts to the local date and time of a timezone', () => {
    expect(localDateTime(new Date('2026-09-27T06:30:00Z'), 'Europe/Berlin')).toEqual({
      date: '2026-09-27',
      minutes: 8 * 60 + 30,
    })
    expect(localDateTime(new Date('2026-09-27T23:30:00Z'), 'Europe/Berlin')).toEqual({
      date: '2026-09-28',
      minutes: 90,
    })
    expect(localDateTime(new Date('2026-01-15T07:00:00Z'), 'Europe/Berlin')).toEqual({
      date: '2026-01-15',
      minutes: 8 * 60,
    })
    expect(localDateTime(new Date('2026-09-27T00:30:00Z'), 'Not/AZone')).toEqual({
      date: '2026-09-27',
      minutes: 30,
    })
  })

  it('makes the digest due once a day at or after digest_time', () => {
    const settings = { digestTime: '08:00:00', timezone: 'Europe/Berlin' }
    expect(digestSlot(new Date('2026-09-27T05:59:00Z'), settings)).toBeNull()
    expect(digestSlot(new Date('2026-09-27T06:00:00Z'), settings)).toBe('2026-09-27')
    expect(digestSlot(new Date('2026-09-27T21:00:00Z'), settings)).toBe('2026-09-27')
    expect(digestSlot(new Date('2026-09-27T22:30:00Z'), settings)).toBeNull()
    expect(digestSlot(new Date('2026-09-28T06:00:00Z'), settings)).toBe('2026-09-28')
  })

  it('parses digest times', () => {
    expect(timeToMinutes('08:00:00')).toBe(480)
    expect(timeToMinutes('7:15')).toBe(435)
    expect(timeToMinutes('garbage')).toBe(480)
  })
})
