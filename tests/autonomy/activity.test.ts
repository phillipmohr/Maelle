import { describe, expect, it } from 'vitest'
import { describeExecution, executionResultLabel } from '../../shared/activity'
import { buildSeed } from '../../shared/seed/data'
import {
  csvCell,
  decodeCursor,
  encodeCursor,
  parseActivityQuery,
  seedActivity,
  seedActivityResponse,
} from '../../server/autonomy/activity'

const now = new Date('2026-09-27T09:50:00Z')
const seed = buildSeed(now, 'test@maelle.local')

describe('parameter lines (design 2c)', () => {
  const items = seedActivity(seed)
  const line = (ticket: number, type: string, status?: string) =>
    describeExecution(
      items.find(
        (i) =>
          i.ticketDisplayNumber === ticket && i.type === type && (!status || i.status === status),
      )!,
    )

  it('formats each action in the voice of the design', () => {
    expect(line(4818, 'send_reply')).toBe('to liam.chen@icloud.com · after 10 min undo window')
    expect(line(4818, 'create_linear_ticket')).toBe('INS-215 · “Date and time in file names”')
    expect(line(4818, 'store_release_notification_email')).toBe('INS-215 · liam.chen@icloud.com')
    expect(line(4815, 'cancel_at_period_end')).toBe('access until Oct 26')
    expect(line(4815, 'store_cancellation_reason')).toBe('“Too expensive” · too_expensive')
    expect(line(4815, 'send_reply')).toBe('to h.schulz@t-online.de · edited')
    expect(line(4812, 'cancel_immediately')).toBe('deleted 3 profiles')
    expect(line(4812, 'refund_latest_payment', 'succeeded')).toBe('$13.07 · Visa ··5521 · retry')
    expect(line(4812, 'refund_latest_payment', 'failed')).toBe('$13.07 · Visa ··5521')
    expect(line(4816, 'create_linear_ticket')).toBe('INS-209 · linked')
    expect(line(4808, 'stop_failed_payment_retries')).toBe('cus_MRossi7712')
  })

  it('labels results', () => {
    expect(executionResultLabel({ type: 'send_reply', status: 'succeeded' })).toEqual({
      tone: 'success',
      label: 'Sent',
    })
    expect(executionResultLabel({ type: 'create_coupon', status: 'succeeded' }).label).toBe(
      'Succeeded',
    )
    expect(executionResultLabel({ type: 'send_reply', status: 'failed' }).tone).toBe('error')
    expect(executionResultLabel({ type: 'send_reply', status: 'held' })).toEqual({
      tone: 'warning',
      label: 'Held',
    })
    expect(executionResultLabel({ type: 'send_reply', status: 'cancelled' })).toEqual({
      tone: 'neutral',
      label: 'Undone',
    })
    expect(executionResultLabel({ type: 'send_reply', status: 'scheduled' }).label).toBe(
      'Scheduled',
    )
  })
})

describe('query parsing and pagination', () => {
  it('parses the query string safely', () => {
    expect(parseActivityQuery({})).toMatchObject({
      by: null,
      irreversibleOnly: false,
      includeSettings: true,
      limit: 100,
      cursor: null,
    })
    expect(
      parseActivityQuery({ by: 'auto', irreversibleOnly: 'true', limit: '9999' }),
    ).toMatchObject({ by: 'auto', irreversibleOnly: true, includeSettings: false, limit: 500 })
    expect(parseActivityQuery({ by: 'nobody', limit: 'x', cursor: 'not-a-cursor' })).toMatchObject({
      by: null,
      limit: 100,
      cursor: null,
    })
    expect(parseActivityQuery({ from: '2026-09-26T00:00:00Z', to: 'garbage' })).toMatchObject({
      from: '2026-09-26T00:00:00.000Z',
      to: null,
    })
  })

  it('round-trips cursors', () => {
    const c = { createdAt: '2026-09-27T07:52:00.000Z', id: '11111111-2222-4333-8444-555555555555' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull()
  })

  it('pages the seed log without overlap or gaps', () => {
    const f = parseActivityQuery({ limit: '7' })
    const all = seedActivityResponse(seed, { ...f, limit: 500 }).items
    const seen: string[] = []
    let cursor = null as ReturnType<typeof decodeCursor>
    for (let i = 0; i < 20; i++) {
      const page = seedActivityResponse(seed, { ...f, cursor })
      seen.push(...page.items.map((x) => x.id))
      cursor = decodeCursor(page.nextCursor)
      if (!cursor) break
    }
    expect(seen).toEqual(all.map((x) => x.id))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('filters by who ran it and irreversible only', () => {
    const auto = seedActivityResponse(seed, parseActivityQuery({ by: 'auto' })).items
    expect(auto.length).toBeGreaterThan(0)
    expect(auto.every((i) => i.executedBy === 'auto')).toBe(true)
    const irr = seedActivityResponse(seed, parseActivityQuery({ irreversibleOnly: 'true' })).items
    expect(irr.every((i) => i.irreversible)).toBe(true)
    expect(irr.map((i) => i.type)).toContain('refund_latest_payment')
  })

  it('escapes CSV cells', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
    expect(csvCell(null)).toBe('')
  })
})
