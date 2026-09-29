import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../shared/seed/data'
import { seedTicketDetail } from '../../shared/seed/views'
import {
  actionState,
  barNote,
  confirmNote,
  effectLine,
  headerChips,
  headerPills,
  irreversibleNow,
  isRoutine,
  outcomeLines,
  paramsSummary,
  pastTense,
  primaryLabel,
  provenanceLine,
  researchMeta,
  riskEyebrow,
  sourceLink,
  toEditable,
  toastLines,
  toastTitle,
} from '../../app/composables/useTicketModel'

const now = new Date('2026-09-27T10:00:00')
const seed = buildSeed(now)
const detail = (n: number) => seedTicketDetail(seed, String(n))!
const actionsOf = (n: number) => detail(n).proposal!.actions.map(toEditable)

describe('ticket model', () => {
  it('labels the primary button and the note per proposal', () => {
    const tom = detail(4824)
    expect(primaryLabel(actionsOf(4824), tom.proposal)).toBe('Approve & execute')
    expect(barNote(actionsOf(4824), tom.proposal, tom.ticket)).toBe(
      '3 actions · all reversible · no confirmation needed',
    )
    expect(isRoutine(actionsOf(4824), tom.ticket)).toBe(true)

    const pvcu = detail(4825)
    expect(primaryLabel(actionsOf(4825), pvcu.proposal)).toBe('Approve & send')
    expect(barNote(actionsOf(4825), pvcu.proposal, pvcu.ticket)).toBe('1 action · reply only')
    expect(isRoutine(actionsOf(4825), pvcu.ticket)).toBe(false)

    const marco = detail(4822)
    expect(primaryLabel(actionsOf(4822), marco.proposal)).toBe('Approve stage 1')
    expect(barNote(actionsOf(4822), marco.proposal, marco.ticket)).toBe(
      'Sends the reply now · refund and cancellation wait for Marco',
    )
    expect(irreversibleNow(actionsOf(4822))).toHaveLength(0)

    const daniel = detail(4809)
    expect(primaryLabel(actionsOf(4809), daniel.proposal)).toBe('Approve & execute')
    expect(irreversibleNow(actionsOf(4809)).map((a) => a.type)).toEqual([
      'refund_latest_payment',
      'cancel_immediately',
    ])
    expect(barNote(actionsOf(4809), daniel.proposal, daniel.ticket)).toBe(
      '3 actions · 2 irreversible · A twice to run',
    )
    expect(confirmNote(actionsOf(4809))).toBe(
      'Refund $13.07 to Visa ··2291 · Cancel immediately and delete 2 profiles',
    )
  })

  it('describes effects and parameters in plain words', () => {
    expect(effectLine({ type: 'delete_account', params: { email: 'a@b.c' } })).toBe(
      'Delete the account a@b.c',
    )
    expect(paramsSummary(actionsOf(4824)[0]!)).toBe('access until Oct 14')
    expect(paramsSummary(actionsOf(4824)[1]!)).toBe('“Not stated”')
    expect(paramsSummary(actionsOf(4825)[0]!, 1)).toBe('to disputes@pvcu.org · 1 attachment')
    expect(paramsSummary(actionsOf(4809)[0]!)).toBe('$13.07 · Sep 9 · Visa ··2291')
    expect(paramsSummary(actionsOf(4809)[1]!)).toBe('deletes 2 profiles')
    expect(paramsSummary(actionsOf(4820)[0]!)).toBe('linked existing INS-198')
    expect(
      paramsSummary({
        type: 'create_coupon',
        params: { kind: 'percent', percentOff: 20, duration: 'once' },
      }),
    ).toBe('20% off · once')
  })

  it('derives the action state from the audit log', () => {
    const priya = detail(4820)
    const acts = actionsOf(4820)
    const pid = priya.proposal!.id
    expect(actionState(acts[0]!, priya.executions, pid).pill).toEqual({
      status: 'success',
      label: 'Linked',
    })
    const failed = actionState(acts[1]!, priya.executions, pid)
    expect(failed.pill).toEqual({ status: 'error', label: 'Failed' })
    expect(failed.error).toMatch(/timed out/)
    expect(actionState(acts[2]!, priya.executions, pid).pill).toEqual({
      status: 'warning',
      label: 'Held back',
    })
    const marco = actionsOf(4822)
    expect(actionState(marco[0]!, [], null).pill).toEqual({
      status: 'info',
      label: 'Queued · pending confirmation',
    })
    expect(actionState(marco[0]!, [], null).tone).toBe('queued')
    expect(actionState(actionsOf(4824)[0]!, [], null).pill).toBeNull()
    const required = { ...actionsOf(4820)[1]!, requiredForReply: true }
    expect(actionState(required, [], null).pill).toEqual({ status: 'draft', label: 'Required' })
    const live = actionState(actionsOf(4824)[0]!, [], null, {
      executionId: 'x',
      type: 'cancel_at_period_end',
      status: 'succeeded',
    })
    expect(live.pill).toEqual({ status: 'success', label: 'Done' })
  })

  it('builds header pills and chips', () => {
    const pvcu = detail(4825)
    expect(headerPills(pvcu.ticket, pvcu.proposal, pvcu.executions).map((p) => p.label)).toEqual([
      'High risk',
      'Needs decision',
    ])
    expect(headerChips(pvcu.ticket, pvcu.proposal, actionsOf(4825), pvcu.executions, now)).toEqual([
      'Due Oct 7',
    ])
    const marco = detail(4822)
    expect(headerPills(marco.ticket, marco.proposal, marco.executions).map((p) => p.label)).toEqual(
      ['Needs customer confirmation', 'Needs decision'],
    )
    expect(
      headerChips(marco.ticket, marco.proposal, actionsOf(4822), marco.executions, now),
    ).toEqual(['Stage 1 of 2'])
    const daniel = detail(4809)
    expect(
      headerPills(daniel.ticket, daniel.proposal, daniel.executions).map((p) => p.label),
    ).toEqual(['Customer confirmed', 'Needs decision'])
    expect(
      headerChips(daniel.ticket, daniel.proposal, actionsOf(4809), daniel.executions, now),
    ).toEqual(['Stage 2 of 2'])
    const priya = detail(4820)
    expect(headerPills(priya.ticket, priya.proposal, priya.executions).map((p) => p.label)).toEqual(
      ['1 action failed'],
    )
    expect(
      headerChips(priya.ticket, priya.proposal, actionsOf(4820), priya.executions, now),
    ).toEqual(['Executed 2m ago'])
    const tom = detail(4824)
    expect(headerChips(tom.ticket, tom.proposal, actionsOf(4824), tom.executions, now)).toEqual([
      'Routine',
    ])
    expect(riskEyebrow(pvcu.ticket)).toBe('High risk · chargeback / bank dispute')
    const unclear = { ...tom.ticket, caseType: 'unclear' as const }
    expect(headerPills(unclear, tom.proposal, []).map((p) => p.label)).toEqual(['Pick the case'])
  })

  it('writes provenance, research meta and source links', () => {
    expect(provenanceLine(detail(4825).proposal!)).toBe(
      'Prepared by AnastasAI from Stripe billing, Supabase activity and the email history',
    )
    expect(provenanceLine(detail(4824).proposal!)).toBe(
      'Prepared by AnastasAI from Stripe billing, the email history and the cancellation only template',
    )
    expect(researchMeta(detail(4825).proposal!, detail(4825).runs)).toBe('3 sources · 22s · $0.42')
    expect(researchMeta(detail(4809).proposal!, detail(4809).runs)).toBe('2 sources · 5s · $0.42')
    expect(researchMeta(detail(4825).proposal!, [{ proposalId: null, durationMs: 3_000 }])).toBe(
      '3 sources · 3s',
    )
    expect(sourceLink({ kind: 'stripe', label: 'Stripe · sub_1', ref: 'sub_1' })).toEqual({
      href: 'https://dashboard.stripe.com/search?query=sub_1',
    })
    expect(sourceLink({ kind: 'linear', label: 'Linear · INS-198', ref: 'INS-198' })).toEqual({
      href: 'https://linear.app/instaradar/issue/INS-198',
    })
    expect(sourceLink({ kind: 'email', label: 'Email history · #4410', ref: '4410' })).toEqual({
      to: '/anastasai/t/4410',
    })
    expect(
      sourceLink({ kind: 'kb', label: 'Knowledge base', ref: '3e8c931f6ae5809fa298d3a8bab0baf9' }),
    ).toEqual({ href: 'https://app.notion.com/p/3e8c931f6ae5809fa298d3a8bab0baf9' })
    expect(sourceLink({ kind: 'supabase', label: 'Supabase' })).toEqual({})
    expect(sourceLink({ kind: 'kb', label: 'x', url: 'https://example.com/p' })).toEqual({
      href: 'https://example.com/p',
    })
  })

  it('writes the toast in the past tense', () => {
    expect(pastTense({ type: 'refund_latest_payment', params: { amountCents: 1307 } })).toBe(
      'Refunded $13.07',
    )
    expect(
      pastTense({ type: 'create_linear_ticket', params: {}, result: { identifier: 'INS-214' } }),
    ).toBe('Created Linear ticket INS-214')
    expect(
      pastTense({
        type: 'create_linear_ticket',
        params: { existingIssueIdentifier: 'INS-198' },
        result: { linked: true },
      }),
    ).toBe('Linked Linear ticket INS-198')
    expect(toastTitle(detail(4817).ticket)).toBe('#4817 Sofia Ruiz · done')
    const lines = toastLines(
      [
        {
          executionId: '1',
          type: 'create_linear_ticket',
          status: 'succeeded',
          result: { identifier: 'INS-214' },
        },
        { executionId: '2', type: 'store_release_notification_email', status: 'succeeded' },
        { executionId: '3', type: 'send_reply', status: 'succeeded' },
      ],
      actionsOf(4817),
    )
    expect(lines).toEqual([
      'Created Linear ticket INS-214',
      'Stored email for release notification',
      'Sent reply',
    ])
    expect(
      toastLines([{ executionId: '1', type: 'refund_latest_payment', status: 'queued' }], []),
    ).toEqual(['Refund latest payment · waits for the customer'])
    expect(outcomeLines(detail(4815))).toEqual([
      'Cancelled at period end',
      'Stored cancellation reason',
      'Sent reply',
    ])
  })
})
