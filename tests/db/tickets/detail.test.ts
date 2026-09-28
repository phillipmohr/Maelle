/**
 * GET /api/tickets/:id against the seeded test database (IRDR-458). Same code as the route
 * (`ticketDetailFromDb`) with a plain pg client.
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ticketDetailFromDb, type QueryExecutor } from '../../../shared/ticket-repository'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('GET /api/tickets/:id (database)', () => {
  let db: pg.Pool
  let exec: QueryExecutor

  beforeAll(async () => {
    db = new pg.Pool({ connectionString: url, max: 4 })
    exec = async (text, params = []) => (await db.query(text, params)).rows
  })
  afterAll(async () => {
    await db?.end()
  })

  it('returns the two-stage refund with its history', async () => {
    const d = await ticketDetailFromDb(exec, '4809')
    expect(d).not.toBeNull()
    expect(d!.ticket.displayNumber).toBe(4809)
    expect(d!.ticket.stage).toBe(2)
    expect(d!.messages).toHaveLength(3)
    expect(d!.messages.map((m) => m.direction)).toEqual(['in', 'out', 'in'])
    expect(d!.messages[1]!.toEmails).toEqual(['d.okafor@proton.me'])
    expect(d!.proposal?.version).toBe(2)
    expect(d!.proposal?.actions.map((a) => a.type)).toEqual([
      'refund_latest_payment',
      'cancel_immediately',
      'send_reply',
    ])
    expect(d!.proposal?.actions[0]!.params).toMatchObject({
      amountCents: 1307,
      cardLabel: 'Visa ··2291',
    })
    expect(d!.proposal?.reply?.to).toBe('d.okafor@proton.me')
    expect(d!.proposal?.researchWarnings).toEqual(['Vercel logs unavailable · not needed here'])
    expect(d!.previousProposals).toHaveLength(1)
    expect(d!.previousProposals[0]!.status).toBe('decided')
    expect(d!.executions).toHaveLength(1)
    expect(d!.decisions).toHaveLength(1)
    expect(d!.runs).toHaveLength(2)
    expect(d!.runs[0]!.trigger).toBe('customer_reply')
    expect(d!.runs[0]!.durationMs).toBe(5000)
  })

  it('accepts "#number" and the uuid, and returns null for unknown ids', async () => {
    const byNumber = await ticketDetailFromDb(exec, '#4820')
    expect(byNumber?.executions.map((e) => e.status)).toEqual(['succeeded', 'failed', 'held'])
    expect(byNumber?.executions[1]!.error).toMatch(/timed out/)
    expect(byNumber?.executions[0]!.externalRefs).toMatchObject({ linearIssue: 'INS-198' })
    const byUuid = await ticketDetailFromDb(exec, byNumber!.ticket.id)
    expect(byUuid?.ticket.displayNumber).toBe(4820)
    expect(await ticketDetailFromDb(exec, 'nope')).toBeNull()
    expect(await ticketDetailFromDb(exec, '')).toBeNull()
    expect(await ticketDetailFromDb(exec, '99999')).toBeNull()
  })

  it('serialises dates as ISO strings and keeps json columns as objects', async () => {
    const d = await ticketDetailFromDb(exec, '4825')
    expect(typeof d!.ticket.createdAt).toBe('string')
    expect(d!.ticket.dueDate).toMatch(/^\d{4}-10-07$/)
    expect(d!.proposal?.dueDate).toMatch(/^\d{4}-10-07$/)
    expect(d!.proposal?.research[0]!.evidence).toHaveLength(4)
    expect(d!.proposal?.reply?.attachments[0]!.name).toBe('stripe-timeline-rkim.png')
    expect(d!.messages[0]!.attachments).toEqual([])
    expect(d!.ticket.customerContext?.timeline).toHaveLength(8)
  })
})
