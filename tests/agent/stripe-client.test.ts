/** The real Stripe adapter against a mocked SDK: no fifth expand level, product names by id. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createStripeReadClient } from '../../server/agent/tools/stripe'

const calls: { list: unknown[]; retrieve: string[] } = { list: [], retrieve: [] }

vi.mock('stripe', () => {
  class Stripe {
    subscriptions = {
      list: async (params: unknown) => {
        calls.list.push(params)
        return {
          data: [
            {
              id: 'sub_1',
              status: 'active',
              created: 1_700_000_000,
              cancel_at_period_end: false,
              items: {
                data: [
                  {
                    price: {
                      id: 'price_1',
                      product: 'prod_1',
                      unit_amount: 1307,
                      currency: 'usd',
                      recurring: { interval: 'month' },
                    },
                  },
                ],
              },
            },
          ],
        }
      },
    }
    products = {
      retrieve: async (id: string) => {
        calls.retrieve.push(id)
        return { id, name: 'InstaRadar Pro' }
      },
    }
  }
  return { default: Stripe }
})

describe('stripe read client', () => {
  beforeEach(() => {
    calls.list = []
    calls.retrieve = []
  })

  it('lists subscriptions without expanding past four levels and names the plan from the product', async () => {
    const client = createStripeReadClient('sk_test')
    const subs = await client.listSubscriptions('cus_1')
    expect(calls.list).toHaveLength(1)
    expect(JSON.stringify(calls.list[0])).not.toContain('price.product')
    expect(calls.retrieve).toEqual(['prod_1'])
    expect(subs[0]).toMatchObject({
      id: 'sub_1',
      status: 'active',
      plan: 'InstaRadar Pro Monthly',
      amountCents: 1307,
      interval: 'month',
    })
  })
})
