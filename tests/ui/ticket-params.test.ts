import { describe, expect, it } from 'vitest'
import { ACTION_TYPES } from '../../shared/actions'
import {
  coerceParam,
  paramFields,
  paramInputValue,
  paramsProblem,
} from '../../app/composables/useTicketParams'

describe('editable action parameters', () => {
  it('has a field list for every action and never exposes ids', () => {
    for (const t of ACTION_TYPES) {
      const fields = paramFields(t)
      expect(Array.isArray(fields)).toBe(true)
      for (const f of fields) expect(f.key).not.toMatch(/Id$|^instaradarUserId$|fromActionPosition/)
    }
    expect(paramFields('refund_latest_payment').map((f) => f.key)).toEqual([
      'amountCents',
      'reason',
    ])
  })

  it('coerces money to cents and back', () => {
    const money = paramFields('refund_latest_payment')[0]!
    expect(coerceParam(money, '13.07')).toBe(1307)
    expect(coerceParam(money, '$ 7.99')).toBe(799)
    expect(coerceParam(money, '')).toBeUndefined()
    expect(paramInputValue(money, 1307)).toBe('13.07')
    const bool = paramFields('send_reply')[1]!
    expect(coerceParam(bool, false)).toBe(false)
    const num = paramFields('create_coupon').find((f) => f.key === 'percentOff')!
    expect(coerceParam(num, '20')).toBe(20)
    expect(coerceParam(num, 'abc')).toBeUndefined()
  })

  it('reports the first validation problem in plain words', () => {
    expect(paramsProblem('send_reply', { to: 'tom.becker@web.de' })).toBeNull()
    expect(paramsProblem('send_reply', { to: 'not-an-email' })).toMatch(/^to: /)
    expect(paramsProblem('refund_latest_payment', { amountCents: 0 })).toMatch(/amountCents/)
  })
})
