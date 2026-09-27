import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  ACTION_LIST,
  ACTION_TYPES,
  IRREVERSIBLE_ACTION_TYPES,
  parseActionParams,
  safeParseActionParams,
  sortByActionOrder,
} from '../../shared/actions'
import {
  CASE_TYPE_LIST,
  CASE_TYPES,
  TEMPLATE_CASE_TYPES,
  caseTypeFromLabel,
} from '../../shared/case-types'

describe('action registry', () => {
  it('has exactly the 11 actions', () => {
    expect(ACTION_TYPES).toHaveLength(11)
    expect(ACTION_LIST.map((a) => a.label)).toEqual([
      'Cancel at period end',
      'Cancel immediately',
      'Refund latest payment',
      'Delete account',
      'Stop failed-payment retries',
      'Create coupon',
      'Create Linear ticket',
      'Store email for release notification',
      'Store cancellation reason',
      'Remove from tracking & viewing',
      'Send reply',
    ])
  })

  it('marks only refund, cancel immediately and delete account as irreversible', () => {
    expect([...IRREVERSIBLE_ACTION_TYPES].sort()).toEqual(
      ['cancel_immediately', 'delete_account', 'refund_latest_payment'].sort(),
    )
    for (const t of IRREVERSIBLE_ACTION_TYPES) expect(ACTIONS[t].lockedByDefault).toBe(true)
  })

  it('always sorts Send reply last', () => {
    const sorted = sortByActionOrder([
      { type: 'send_reply' },
      { type: 'store_cancellation_reason' },
      { type: 'cancel_at_period_end' },
    ] as const)
    expect(sorted.map((a) => a.type)).toEqual([
      'cancel_at_period_end',
      'store_cancellation_reason',
      'send_reply',
    ])
    expect(ACTIONS.send_reply.order).toBeGreaterThan(
      Math.max(...ACTION_LIST.filter((a) => a.key !== 'send_reply').map((a) => a.order)),
    )
  })

  it('validates params per action', () => {
    expect(
      parseActionParams('refund_latest_payment', {
        stripePaymentIntentId: 'pi_1',
        amountCents: 1307,
      }),
    ).toMatchObject({
      amountCents: 1307,
      currency: 'usd',
      reason: 'requested_by_customer',
    })
    expect(safeParseActionParams('refund_latest_payment', { amountCents: -5 }).success).toBe(false)
    expect(safeParseActionParams('send_reply', { to: 'not-an-email' }).success).toBe(false)
    expect(
      parseActionParams('remove_from_tracking', {
        instagramHandle: '@Studio.Kolo',
        reason: 'threats',
      }).instagramHandle,
    ).toBe('studio.kolo')
    expect(
      safeParseActionParams('create_linear_ticket', {
        title: 'x',
        description: 'd',
        label: 'Bug',
        customerEmail: 'a@b.co',
      }).success,
    ).toBe(false)
  })
})

describe('case types', () => {
  it('has the 17 Notion templates plus release_notification and unclear', () => {
    expect(TEMPLATE_CASE_TYPES).toHaveLength(17)
    expect(CASE_TYPE_LIST).toHaveLength(19)
    for (const k of TEMPLATE_CASE_TYPES)
      expect(CASE_TYPES[k].notionPageId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('uses the exact Notion names as labels', () => {
    expect(CASE_TYPES.refund_request.label).toBe('Refund request (latest payment)')
    expect(CASE_TYPES.cannot_cancel.label).toBe('Cannot cancel (missing button)')
    expect(caseTypeFromLabel('Chargeback / bank dispute')).toBe('chargeback')
    expect(caseTypeFromLabel('Refund request')).toBe('refund_request')
  })

  it('lists only registry actions, in registry order, Send reply last', () => {
    for (const c of CASE_TYPE_LIST) {
      const orders = c.defaultActions.map((a) => ACTIONS[a].order)
      expect([...orders].sort((a, b) => a - b)).toEqual(orders)
      if (c.defaultActions.length > 0) expect(c.defaultActions.at(-1)).toBe('send_reply')
    }
    expect(CASE_TYPES.unclear.defaultActions).toEqual([])
  })

  it('requires confirmation exactly where Notion does', () => {
    const confirm = CASE_TYPE_LIST.filter((c) => c.requiresConfirmation).map((c) => c.key)
    expect(confirm.sort()).toEqual(
      ['account_deletion', 'cancellation_refund_deletion', 'refund_request'].sort(),
    )
  })
})
