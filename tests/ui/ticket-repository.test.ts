import { describe, expect, it } from 'vitest'
import {
  decodeClosedCursor,
  encodeClosedCursor,
  isClosedOnly,
  normalizeDbRow,
  parseTicketListQuery,
  ticketCountsSql,
  ticketListSql,
} from '../../shared/ticket-repository'
import { isRealtimeUrl } from '../../app/composables/useRealtime'

describe('ticket list query parsing', () => {
  it('parses statuses, filters and the limit', () => {
    const q = parseTicketListQuery({
      status: 'closed,bogus, snoozed',
      q: ' hannah ',
      caseType: 'bug_report',
      resolution: 'auto',
      limit: '5',
    })
    expect(q.statuses).toEqual(['closed', 'snoozed'])
    expect(q.q).toBe('hannah')
    expect(q.caseType).toBe('bug_report')
    expect(q.resolution).toBe('auto')
    expect(q.limit).toBe(5)
    expect(isClosedOnly(q)).toBe(false)
    expect(parseTicketListQuery({}).statuses).toBeNull()
    expect(parseTicketListQuery({ status: 'all' }).statuses).toBeNull()
    expect(parseTicketListQuery({}).limit).toBe(200)
    expect(parseTicketListQuery({ limit: '-3' }).limit).toBe(200)
    expect(parseTicketListQuery({ from: 'not a date' }).from).toBeNull()
    expect(parseTicketListQuery({ from: '2026-09-25' }).from).toBe(
      new Date('2026-09-25').toISOString(),
    )
  })

  it('round-trips the closed cursor', () => {
    const c = { closedAt: '2026-09-26T16:22:00.000Z', id: '2a3b4c5d-0000-8000-8000-000000000001' }
    const s = encodeClosedCursor(c)
    expect(s).not.toMatch(/[+/=]/)
    expect(decodeClosedCursor(s)).toEqual(c)
    expect(decodeClosedCursor('garbage')).toBeNull()
    expect(decodeClosedCursor('')).toBeNull()
    expect(decodeClosedCursor(encodeClosedCursor({ closedAt: 'nope', id: 'x' }))).toBeNull()
    const q = parseTicketListQuery({ status: 'closed', cursor: s })
    expect(isClosedOnly(q)).toBe(true)
    expect(q.cursor).toEqual(c)
  })

  it('builds parameterised SQL with the cursor only for the closed history', () => {
    const closed = ticketListSql(
      parseTicketListQuery({
        status: 'closed',
        cursor: encodeClosedCursor({ closedAt: '2026-09-26T16:22:00.000Z', id: 'abc' }),
        limit: 4,
      }),
    )
    expect(closed.text).toMatch(/\(t\.closed_at, t\.id\) < \(\$2::timestamptz, \$3::uuid\)/)
    expect(closed.text).toMatch(/order by t\.closed_at desc, t\.id desc/)
    expect(closed.params).toEqual([['closed'], '2026-09-26T16:22:00.000Z', 'abc', 5])
    const mixed = ticketListSql(parseTicketListQuery({ q: '#4825', caseType: 'chargeback' }))
    expect(mixed.text).not.toMatch(/cursor|<\s*\(/)
    expect(mixed.text).toMatch(/\(t\.status = 'closed'\) asc/)
    expect(mixed.params).toEqual(['chargeback', '%4825%', 201])
    const escaped = ticketListSql(parseTicketListQuery({ q: '100%_x' }))
    expect(escaped.params[0]).toBe('%100\\%\\_x%')
    const counts = ticketCountsSql(new Date('2026-09-27T10:00:00'))
    expect(counts.params).toHaveLength(2)
    expect(counts.text).toMatch(/closed_last_3_days/)
  })

  it('normalises pg Date values to ISO strings', () => {
    const row = normalizeDbRow({
      id: 'x',
      created_at: new Date('2026-09-27T10:00:00Z'),
      tags: ['a'],
      n: 1,
    })
    expect(row.created_at).toBe('2026-09-27T10:00:00.000Z')
    expect(row.tags).toEqual(['a'])
    expect(row.n).toBe(1)
  })
})

describe('realtime guard', () => {
  it('only accepts a real https Supabase URL', () => {
    expect(isRealtimeUrl('https://abcd.supabase.co')).toBe(true)
    expect(isRealtimeUrl('http://127.0.0.1:54321')).toBe(false)
    expect(isRealtimeUrl('https://127.0.0.1:54321')).toBe(false)
    expect(isRealtimeUrl('https://localhost:54321')).toBe(false)
    expect(isRealtimeUrl('https://your-project.supabase.co')).toBe(false)
    expect(isRealtimeUrl(undefined)).toBe(false)
    expect(isRealtimeUrl('')).toBe(false)
  })
})
