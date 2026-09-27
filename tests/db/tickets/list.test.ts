/**
 * GET /api/tickets against the seeded test database (IRDR-458). Runs the same code as the route
 * (`ticketListFromDb`) with a plain pg client. `pnpm test:db` sets TEST_DATABASE_URL.
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  parseTicketListQuery,
  ticketListFromDb,
  type QueryExecutor,
} from '../../../shared/ticket-repository'
import { SEED_CLOSED_TICKETS, SEED_OPEN_TICKETS } from '../../../shared/seed/data'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('GET /api/tickets (database)', () => {
  let db: pg.Pool
  let exec: QueryExecutor

  beforeAll(async () => {
    db = new pg.Pool({ connectionString: url, max: 4 })
    exec = async (text, params = []) => (await db.query(text, params)).rows
  })
  afterAll(async () => {
    await db?.end()
  })

  it('returns every ticket, open first, with the inbox counts', async () => {
    const res = await ticketListFromDb(exec, parseTicketListQuery({}))
    expect(res.items).toHaveLength(SEED_OPEN_TICKETS.length + SEED_CLOSED_TICKETS.length)
    const firstClosed = res.items.findIndex((i) => i.status === 'closed')
    expect(firstClosed).toBe(SEED_OPEN_TICKETS.length)
    expect(res.items.slice(firstClosed).every((i) => i.status === 'closed')).toBe(true)
    expect(res.nextCursor).toBeNull()
    expect(res.counts).toMatchObject({
      needsDecision: 7,
      waitingOnCustomer: 0,
      snoozed: 1,
      autoPending: 0,
      closedLast3Days: 10,
      closedToday: 2,
    })
  })

  it('shapes the rows like the seed views do', async () => {
    const res = await ticketListFromDb(exec, parseTicketListQuery({}))
    const pvcu = res.items.find((i) => i.displayNumber === 4825)!
    expect(pvcu.riskLevel).toBe('high')
    expect(pvcu.dueDate).toMatch(/^\d{4}-10-07$/)
    expect(pvcu.proposalLine).toMatch(/Contest the dispute/)
    expect(pvcu.actionCount).toBe(1)
    expect(pvcu.tags).toEqual(['Long-term', 'Resubscribed'])
    expect(pvcu.customerContext?.plan[0]).toEqual({ label: 'Plan', value: 'Pro Monthly' })
    expect(typeof pvcu.createdAt).toBe('string')
    expect(() => new Date(pvcu.createdAt).toISOString()).not.toThrow()

    const amelie = res.items.find((i) => i.displayNumber === 4828)!
    expect(amelie.status).toBe('researching')
    expect(amelie.runProgress).toMatchObject({ stripe: 'ok', vercel: 'pending' })

    const priya = res.items.find((i) => i.displayNumber === 4820)!
    expect(priya.whatRan).toMatch(/linked INS-198/)
    expect(priya.decision).toBe('approved')

    const hannah = res.items.find((i) => i.displayNumber === 4815)!
    expect(hannah.decision).toBe('approved_with_edits')
    expect(hannah.decisionNote).toBe('Reply shortened')
    expect(hannah.whatRan).toBe('Cancel at period end · Store cancellation reason · Send reply')
  })

  it('pages the closed history by closed_at desc, id with a cursor', async () => {
    const seen: number[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res = await ticketListFromDb(
        exec,
        parseTicketListQuery({ status: 'closed', limit: 4, cursor: cursor ?? undefined }),
      )
      pages++
      expect(res.items.length).toBeLessThanOrEqual(4)
      expect(res.items.every((i) => i.status === 'closed')).toBe(true)
      for (let i = 1; i < res.items.length; i++) {
        expect(res.items[i - 1]!.closedAt! >= res.items[i]!.closedAt!).toBe(true)
      }
      seen.push(...res.items.map((i) => i.displayNumber))
      cursor = res.nextCursor
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(SEED_CLOSED_TICKETS.length)
    expect(seen.slice(0, 2)).toEqual([4818, 4817])
  })

  it('filters by status list, case type, resolution, date range and search', async () => {
    const snoozed = await ticketListFromDb(exec, parseTicketListQuery({ status: 'snoozed' }))
    expect(snoozed.items.map((i) => i.displayNumber)).toEqual([4801])

    const open = await ticketListFromDb(
      exec,
      parseTicketListQuery({ status: 'needs_decision,action_failed' }),
    )
    expect(open.items.map((i) => i.status).every((s) => s !== 'closed')).toBe(true)
    expect(open.items).toHaveLength(6)

    const refunds = await ticketListFromDb(
      exec,
      parseTicketListQuery({ caseType: 'refund_request' }),
    )
    expect(refunds.items.map((i) => i.displayNumber).sort()).toEqual([4809, 4812, 4822])

    const edited = await ticketListFromDb(
      exec,
      parseTicketListQuery({ status: 'closed', resolution: 'approved_with_edits' }),
    )
    expect(edited.items.map((i) => i.displayNumber).sort()).toEqual([4808, 4815])

    const hannah = await ticketListFromDb(exec, parseTicketListQuery({ q: 'hannah' }))
    expect(hannah.items.map((i) => i.displayNumber)).toEqual([4815])
    const byNumber = await ticketListFromDb(exec, parseTicketListQuery({ q: '#4825' }))
    expect(byNumber.items.map((i) => i.displayNumber)).toEqual([4825])
    const byProposal = await ticketListFromDb(exec, parseTicketListQuery({ q: 'INS-198' }))
    expect(byProposal.items.map((i) => i.displayNumber)).toEqual([4820])

    const all = await ticketListFromDb(exec, parseTicketListQuery({ status: 'closed' }))
    const newest = all.items[0]!.closedAt!
    const ranged = await ticketListFromDb(
      exec,
      parseTicketListQuery({ status: 'closed', from: newest, to: newest }),
    )
    expect(ranged.items.map((i) => i.displayNumber)).toEqual([all.items[0]!.displayNumber])
  })

  it('ignores unknown filter values and caps the limit', async () => {
    const q = parseTicketListQuery({
      status: 'bogus',
      caseType: 'nope',
      resolution: 'maybe',
      limit: '99999',
      cursor: 'not-a-cursor',
    })
    expect(q.statuses).toBeNull()
    expect(q.caseType).toBeNull()
    expect(q.resolution).toBeNull()
    expect(q.cursor).toBeNull()
    expect(q.limit).toBe(500)
    const res = await ticketListFromDb(exec, q)
    expect(res.items.length).toBeGreaterThan(0)
  })
})
