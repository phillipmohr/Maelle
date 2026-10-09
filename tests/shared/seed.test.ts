import { describe, expect, it } from 'vitest'
import { ProposalSchema } from '../../shared/proposal'
import { buildSeed, SEED_CLOSED_TICKETS, SEED_OPEN_TICKETS } from '../../shared/seed/data'
import { seedTicketDetail, seedTicketList } from '../../shared/seed/views'
import { ACTIONS } from '../../shared/actions'
import { isTicketStatus } from '../../shared/status'
import { isCaseType } from '../../shared/case-types'

const now = new Date('2026-09-27T09:50:00Z')
const seed = buildSeed(now, 'test@maelle.local')

describe('seed data', () => {
  it('contains the design tickets', () => {
    const numbers = seed.tickets.map((t) => t.display_number as number)
    for (const n of [...SEED_OPEN_TICKETS, ...SEED_CLOSED_TICKETS]) expect(numbers).toContain(n)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('uses only known statuses, case types and actions', () => {
    for (const t of seed.tickets) {
      expect(isTicketStatus(t.status)).toBe(true)
      if (t.case_type != null) expect(isCaseType(t.case_type)).toBe(true)
    }
    for (const a of seed.proposed_actions) expect((a.action_type as string) in ACTIONS).toBe(true)
    for (const e of seed.action_executions) expect((e.action_type as string) in ACTIONS).toBe(true)
  })

  it('every seeded proposal validates against the Proposal schema', () => {
    for (const p of seed.proposals) {
      const actions = seed.proposed_actions
        .filter((a) => a.proposal_id === p.id)
        .sort((a, b) => (a.position as number) - (b.position as number))
        .map((a) => ({
          type: a.action_type,
          params: a.params,
          reason: a.reason,
          stage: a.stage,
          requiredForReply: a.required_for_reply,
          enabled: a.enabled,
        }))
      const result = ProposalSchema.safeParse({
        case: p.case_type,
        confidence: p.confidence,
        candidateCases: p.candidate_cases,
        risk: { level: p.risk_level, reason: p.risk_reason, dueDate: p.due_date },
        customerConfirmationNeeded: p.customer_confirmation_needed,
        stage: p.stage,
        summaryLine: p.summary_line,
        metaLine: p.meta_line,
        research: p.research,
        researchWarnings: p.research_warnings,
        policyWarnings: p.policy_warnings,
        conclusion: p.conclusion,
        actions,
        reply: p.reply_draft,
        knowledgeRefs: p.knowledge_refs,
        noKnowledgeFound: p.no_knowledge_found,
        handoff: p.handoff_reason ? { reason: p.handoff_reason } : null,
      })
      if (!result.success) {
        throw new Error(
          `proposal ${String(p.ticket_id)} v${String(p.version)}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        )
      }
    }
  })

  it('has unique idempotency keys and ids', () => {
    const keys = seed.action_executions.map((e) => e.idempotency_key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const table of Object.values(seed)) {
      const ids = (table as { id?: string }[]).map((r) => r.id).filter(Boolean)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('builds the inbox list and counts', () => {
    const list = seedTicketList(seed, now)
    // pvcu, tom, marco, daniel, priya, jonas + amélie (researching counts as open)
    expect(list.counts.needsDecision).toBe(7)
    expect(list.counts.snoozed).toBe(1)
    const pvcu = list.items.find((i) => i.displayNumber === 4825)!
    expect(pvcu.riskLevel).toBe('high')
    expect(pvcu.proposalLine).toMatch(/Contest the dispute/)
    const priya = list.items.find((i) => i.displayNumber === 4820)!
    expect(priya.status).toBe('action_failed')
    expect(priya.whatRan).toMatch(/linked INS-198/)
  })

  it('builds a ticket detail with the two-stage history', () => {
    const d = seedTicketDetail(seed, '4809')!
    expect(d.ticket.stage).toBe(2)
    expect(d.messages).toHaveLength(3)
    expect(d.proposal?.version).toBe(2)
    expect(d.previousProposals).toHaveLength(1)
    expect(d.proposal?.actions.map((a) => a.type)).toEqual([
      'refund_latest_payment',
      'cancel_immediately',
      'send_reply',
    ])
    expect(seedTicketDetail(seed, '#4820')?.executions.map((e) => e.status)).toEqual([
      'succeeded',
      'failed',
      'held',
    ])
    expect(seedTicketDetail(seed, 'nope')).toBeNull()
  })
})
