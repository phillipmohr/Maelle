import { describe, expect, it } from 'vitest'
import {
  ConfirmRequiredError,
  deriveCustomerConfirmed,
  planApprove,
  waitingForText,
} from '../../server/executor/decision'
import { ExecutorError } from '../../server/executor/errors'
import { makeProposal, REPLY } from './helpers'

const asIs = (p = makeProposal()) => ({
  proposalVersion: p.version,
  actions: p.actions.map((a) => ({ position: a.position, enabled: a.enabled })),
})

describe('planApprove', () => {
  it('approves a routine proposal unchanged, in registry order with Send reply last', () => {
    const plan = planApprove(makeProposal(), asIs())
    expect(plan.decision).toBe('approved')
    expect(plan.replyDiff).toBeNull()
    expect(plan.actionChanges).toEqual([])
    expect(plan.actions.map((a) => a.type)).toEqual([
      'cancel_at_period_end',
      'store_cancellation_reason',
      'send_reply',
    ])
    expect(plan.actions[1]!.params).toMatchObject({ feedback: 'other', comment: 'Not stated' })
    expect(plan.replyDraft?.body).toBe(REPLY.body)
  })

  it('rejects a stale version with 409', () => {
    expect(() => planApprove(makeProposal(), { ...asIs(), proposalVersion: 0 })).toThrowError(
      expect.objectContaining({ statusCode: 409, data: { error: 'stale_version', current: 1 } }),
    )
  })

  it('rejects unknown positions, unknown actions and invalid params with 400', () => {
    const p = makeProposal()
    expect(() =>
      planApprove(p, { proposalVersion: 1, actions: [{ position: 9, enabled: true }] }),
    ).toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(() =>
      planApprove(p, {
        ...asIs(p),
        addedActions: [{ type: 'delete_everything' as never, params: {}, reason: 'x' }],
      }),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        data: expect.objectContaining({ error: 'unknown_action' }),
      }),
    )
    expect(() =>
      planApprove(p, {
        proposalVersion: 1,
        actions: [{ position: 0, enabled: true, params: { stripeSubscriptionId: '' } }],
      }),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        data: expect.objectContaining({ error: 'invalid_params' }),
      }),
    )
  })

  it('demands confirmIrreversible for enabled irreversible now actions and lists their effects', () => {
    const p = makeProposal({
      caseType: 'refund_request',
      stage: 2,
      actions: [
        {
          id: 'a0',
          position: 0,
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_1', amountCents: 1307, cardLabel: 'Visa ··2291' },
          reason: 'r',
          stage: 'now',
          requiredForReply: false,
          enabled: true,
        },
        {
          id: 'a1',
          position: 1,
          type: 'cancel_immediately',
          params: { stripeSubscriptionId: 'sub_1', profilesAffected: 2 },
          reason: 'r',
          stage: 'now',
          requiredForReply: false,
          enabled: true,
        },
        {
          id: 'a2',
          position: 2,
          type: 'send_reply',
          params: { to: 'd@x.co' },
          reason: 'r',
          stage: 'now',
          requiredForReply: false,
          enabled: true,
        },
      ],
    })
    let caught: unknown
    try {
      planApprove(p, asIs(p))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConfirmRequiredError)
    const body = (caught as ConfirmRequiredError).body
    expect(body.error).toBe('confirm_required')
    expect(body.irreversible).toEqual([
      { position: 0, type: 'refund_latest_payment', effect: 'Refund $13.07 to Visa ··2291' },
      {
        position: 1,
        type: 'cancel_immediately',
        effect: 'Cancel immediately and delete 2 tracked profiles',
      },
    ])
    const ok = planApprove(p, { ...asIs(p), confirmIrreversible: true })
    expect(ok.irreversibleNow).toHaveLength(2)
    // Queued (after_confirmation) irreversible actions do not need the confirm.
    const stage1 = makeProposal({
      ...p,
      customerConfirmationNeeded: true,
      stage: 1,
      actions: p.actions.map((a) =>
        a.type === 'send_reply' ? a : { ...a, stage: 'after_confirmation' as const },
      ),
    })
    expect(planApprove(stage1, asIs(stage1)).irreversibleNow).toEqual([])
  })

  it('records edits: reply diff, toggles, param changes and added actions', () => {
    const p = makeProposal()
    const plan = planApprove(p, {
      proposalVersion: 1,
      actions: [
        {
          position: 0,
          enabled: true,
          params: { stripeSubscriptionId: 'sub_1PzT8c', accessUntil: '2026-10-15' },
        },
        { position: 1, enabled: false },
        { position: 2, enabled: true },
      ],
      reply: { subject: REPLY.subject, body: REPLY.body.replace('cancelled', 'canceled') },
      addedActions: [
        {
          type: 'create_coupon',
          params: { kind: 'percent', percentOff: 20, stripeSubscriptionId: 'sub_1PzT8c' },
          reason: 'Goodwill',
        },
      ],
    })
    expect(plan.decision).toBe('approved_with_edits')
    expect(plan.replyDiff?.added).toBe(1)
    expect(plan.actionChanges).toEqual([
      { position: 0, field: 'params.accessUntil', from: '2026-10-14', to: '2026-10-15' },
      { position: 1, field: 'enabled', from: true, to: false },
      { position: 3, field: 'added', from: null, to: 'create_coupon' },
    ])
    expect(plan.actions.map((a) => [a.type, a.position])).toEqual([
      ['cancel_at_period_end', 0],
      ['create_coupon', 3],
      ['send_reply', 2],
    ])
    expect(plan.actions[1]!.added).toBe(true)
    expect(plan.actions[1]!.params).toMatchObject({ duration: 'once', applyTo: 'subscription' })
  })

  it('refuses em dashes, empty replies, duplicate Send reply and unclear cases', () => {
    const p = makeProposal()
    expect(() =>
      planApprove(p, { ...asIs(p), reply: { subject: 'Re', body: 'Hi Tom — done.' } }),
    ).toThrowError(expect.objectContaining({ statusCode: 400, data: { error: 'em_dash' } }))
    expect(() => planApprove(p, { ...asIs(p), reply: { subject: ' ', body: 'x' } })).toThrowError(
      expect.objectContaining({ statusCode: 400, data: { error: 'empty_reply' } }),
    )
    expect(() =>
      planApprove(p, {
        ...asIs(p),
        addedActions: [{ type: 'send_reply', params: { to: 'a@b.co' }, reason: 'x' }],
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 400, data: { error: 'duplicate_reply' } }))
    const unclear = makeProposal({ caseType: 'unclear', actions: [], replyDraft: null })
    expect(() => planApprove(unclear, { proposalVersion: 1, actions: [] })).toThrowError(
      expect.objectContaining({ statusCode: 422 }),
    )
    const noDraft = makeProposal({ replyDraft: null })
    const err = (() => {
      try {
        planApprove(noDraft, asIs(noDraft))
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(ExecutorError)
    expect((err as ExecutorError).statusCode).toBe(422)
  })
})

describe('customer confirmation and waiting text', () => {
  it('derives the confirmation from stage 2, the thread or the note', () => {
    expect(deriveCustomerConfirmed(makeProposal({ stage: 2 }), undefined, true)).toBe(true)
    expect(
      deriveCustomerConfirmed(makeProposal({ customerConfirmationNeeded: false }), undefined, true),
    ).toBe(true)
    expect(
      deriveCustomerConfirmed(makeProposal({ customerConfirmationNeeded: true }), undefined, true),
    ).toBe(false)
    expect(deriveCustomerConfirmed(makeProposal(), undefined, false)).toBe(false)
    expect(deriveCustomerConfirmed(makeProposal(), 'Customer confirmed by phone', false)).toBe(true)
  })

  it('quotes the confirmation phrase from the reply', () => {
    expect(
      waitingForText({ ...REPLY, body: 'Just reply “Yes, refund” to confirm.' }, [
        'refund_latest_payment',
      ]),
    ).toBe('Waiting for “Yes, refund”')
    expect(waitingForText(null, ['delete_account'])).toBe('Waiting for “Yes, delete”')
    expect(waitingForText(null, ['refund_latest_payment'])).toBe('Waiting for “Yes, refund”')
    expect(waitingForText(null, [])).toBe("Waiting for the customer's confirmation")
  })
})
