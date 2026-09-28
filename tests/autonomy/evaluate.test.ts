import { describe, expect, it } from 'vitest'
import { createStubNotify } from '../../shared/services-stubs'
import {
  createAutonomyService,
  decide,
  type EvaluateContext,
  type EvaluateProposal,
  type EvaluateTicket,
} from '../../server/autonomy/evaluate'

const ticket: EvaluateTicket = {
  id: 'b8a6e8f0-0000-4000-8000-000000004824',
  displayNumber: 4824,
  customerName: 'Tom Becker',
  customerEmail: 'tom.becker@web.de',
  status: 'needs_decision',
  caseType: 'cancellation_only',
  riskLevel: 'none',
  dueDate: null,
}

const proposal: EvaluateProposal = {
  caseType: 'cancellation_only',
  riskLevel: 'none',
  policyWarnings: [],
  customerConfirmationNeeded: false,
  stage: 1,
  actions: [
    { type: 'cancel_at_period_end', enabled: true, stage: 'now' },
    { type: 'store_cancellation_reason', enabled: true, stage: 'now' },
    { type: 'send_reply', enabled: true, stage: 'now' },
  ],
}

const base: EvaluateContext = {
  ticket,
  proposal,
  mode: 'auto',
  globalPause: false,
  locks: {},
  databaseConfigured: true,
}

describe('decide', () => {
  it('runs on Auto only when every guard passes', () => {
    expect(decide(base)).toEqual({ verdict: 'auto', reason: 'auto', detail: 'Every guard passed' })
  })

  it('asks when the case is on Always ask or automation is paused', () => {
    expect(decide({ ...base, mode: 'always_ask' }).reason).toBe('always_ask')
    expect(decide({ ...base, globalPause: true }).reason).toBe('paused')
  })

  it('never auto-executes safety or high-risk tickets', () => {
    expect(decide({ ...base, ticket: { ...ticket, riskLevel: 'safety' } }).reason).toBe('safety')
    expect(decide({ ...base, ticket: { ...ticket, riskLevel: 'high' } }).reason).toBe('high_risk')
    // the proposal may carry the risk while the ticket row still says none
    expect(decide({ ...base, proposal: { ...proposal, riskLevel: 'high' } }).reason).toBe(
      'high_risk',
    )
  })

  it('asks on policy warnings, unclear cases and pending customer confirmation', () => {
    expect(
      decide({ ...base, proposal: { ...proposal, policyWarnings: ['Second refund'] } }).reason,
    ).toBe('policy_warnings')
    expect(decide({ ...base, proposal: { ...proposal, caseType: 'unclear' } }).reason).toBe(
      'unclear',
    )
    expect(
      decide({ ...base, proposal: { ...proposal, customerConfirmationNeeded: true, stage: 1 } })
        .reason,
    ).toBe('confirmation_pending')
    expect(decide({ ...base, proposal: null }).reason).toBe('no_proposal')
    expect(decide({ ...base, ticket: null }).reason).toBe('not_found')
    expect(decide({ ...base, databaseConfigured: false }).reason).toBe('no_database')
  })

  it('falls back to Always ask when an enabled action is locked (registry default or row)', () => {
    const withRefund: EvaluateProposal = {
      ...proposal,
      caseType: 'charged_after_cancellation',
      actions: [
        { type: 'stop_failed_payment_retries', enabled: true, stage: 'now' },
        { type: 'refund_latest_payment', enabled: true, stage: 'now' },
        { type: 'send_reply', enabled: true, stage: 'now' },
      ],
    }
    expect(decide({ ...base, proposal: withRefund }).reason).toBe('locked_action')
    expect(
      decide({ ...base, proposal: withRefund, locks: { refund_latest_payment: false } }).verdict,
    ).toBe('auto')
    // a disabled locked action does not block
    const disabled = {
      ...withRefund,
      actions: withRefund.actions.map((a) =>
        a.type === 'refund_latest_payment' ? { ...a, enabled: false } : a,
      ),
    }
    expect(decide({ ...base, proposal: disabled }).verdict).toBe('auto')
    // an explicitly locked reversible action blocks
    expect(decide({ ...base, locks: { cancel_at_period_end: true } }).reason).toBe('locked_action')
  })

  it('asks when nothing is enabled', () => {
    const none = { ...proposal, actions: proposal.actions.map((a) => ({ ...a, enabled: false })) }
    expect(decide({ ...base, proposal: none }).reason).toBe('no_actions')
  })
})

describe('createAutonomyService', () => {
  function service(ctx: EvaluateContext) {
    const notify = createStubNotify()
    const svc = createAutonomyService({
      loadContext: async () => ctx,
      notify: () => notify,
      siteUrl: () => 'https://maelle.example/',
      log: () => {},
    })
    return { svc, notify }
  }

  it('returns the verdict and alerts on safety tickets with the ticket link', async () => {
    const safety: EvaluateTicket = {
      ...ticket,
      displayNumber: 4830,
      riskLevel: 'safety',
      caseType: 'safety_removal',
    }
    const { svc, notify } = service({
      ...base,
      ticket: safety,
      proposal: { ...proposal, caseType: 'safety_removal', riskLevel: 'safety' },
    })
    expect(await svc.evaluate(safety.id)).toBe('ask')
    expect(notify.calls).toHaveLength(1)
    expect(notify.calls[0]!.kind).toBe('high_risk_ticket')
    expect(notify.calls[0]!.payload).toMatchObject({
      ticketId: safety.id,
      displayNumber: 4830,
      caseType: 'safety_removal',
      riskLevel: 'safety',
      url: 'https://maelle.example/anastasai/t/4830',
    })
  })

  it('does not alert on routine tickets and never calls runAuto itself', async () => {
    const { svc, notify } = service(base)
    expect(await svc.evaluate(ticket.id)).toBe('auto')
    expect(notify.calls).toHaveLength(0)
  })

  it('keeps the verdict when the alert fails', async () => {
    const svc = createAutonomyService({
      loadContext: async () => ({ ...base, ticket: { ...ticket, riskLevel: 'high' } }),
      notify: () => async () => {
        throw new Error('mail down')
      },
      siteUrl: () => 'http://localhost:3000',
      log: () => {},
    })
    expect(await svc.evaluateDetailed(ticket.id)).toMatchObject({
      verdict: 'ask',
      reason: 'high_risk',
    })
  })
})
