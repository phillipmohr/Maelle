import { describe, expect, it } from 'vitest'
import { followUpKindDue } from '../../shared/follow-up'

const DAY = 24 * 60 * 60 * 1000
const since = new Date('2026-09-20T10:00:00Z')
const at = (days: number) => new Date(since.getTime() + days * DAY)

describe('followUpKindDue', () => {
  it('is null before follow_up_days, follow_up after, auto_close after auto_close_days', () => {
    const s = { followUpDays: 3, autoCloseDays: 7 }
    expect(followUpKindDue(s, since, at(2.9))).toBeNull()
    expect(followUpKindDue(s, since, at(3))).toBe('follow_up')
    expect(followUpKindDue(s, since, at(6.9))).toBe('follow_up')
    expect(followUpKindDue(s, since, at(7))).toBe('auto_close')
    expect(followUpKindDue(s, since, at(100))).toBe('auto_close')
  })

  it('treats zero as disabled', () => {
    expect(followUpKindDue({ followUpDays: 0, autoCloseDays: 7 }, since, at(5))).toBeNull()
    expect(followUpKindDue({ followUpDays: 3, autoCloseDays: 0 }, since, at(50))).toBe('follow_up')
  })
})
