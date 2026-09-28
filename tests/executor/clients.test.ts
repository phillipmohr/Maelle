import { describe, expect, it } from 'vitest'
import { createClientsFromEnv, fakesAllowed } from '../../server/executor/clients'
import { createFakeStripe } from '../../server/executor/clients/stripe-fake'
import { USER_TABLES } from '../../server/executor/clients/instaradar'
import { ProviderError, formatActionError } from '../../server/executor/errors'

describe('fake Stripe idempotency', () => {
  it('replays the same response for the same key and params, and rejects different params', async () => {
    const s = createFakeStripe()
    s.seedCustomer({
      customer: 'c',
      subscription: 'sub',
      paymentIntent: 'pi',
      charge: 'ch',
      amount: 1000,
    })
    const a = await s.createRefund(
      { charge: 'ch', amount: 400, reason: 'requested_by_customer', metadata: {} },
      { idempotencyKey: 'k1' },
    )
    const b = await s.createRefund(
      { charge: 'ch', amount: 400, reason: 'requested_by_customer', metadata: {} },
      { idempotencyKey: 'k1' },
    )
    expect(b.id).toBe(a.id)
    expect(s.state.charges.get('ch')?.amountRefunded).toBe(400)
    await expect(
      s.createRefund(
        { charge: 'ch', amount: 500, reason: 'requested_by_customer', metadata: {} },
        { idempotencyKey: 'k1' },
      ),
    ).rejects.toMatchObject({ code: 'idempotency_error' })
    const c = await s.createRefund(
      { charge: 'ch', amount: 600, reason: 'requested_by_customer', metadata: {} },
      { idempotencyKey: 'k2' },
    )
    expect(c.id).not.toBe(a.id)
    expect(s.state.charges.get('ch')?.refunded).toBe(true)
    await expect(
      s.createRefund(
        { charge: 'ch', amount: 1, reason: 'requested_by_customer', metadata: {} },
        { idempotencyKey: 'k3' },
      ),
    ).rejects.toMatchObject({ code: 'charge_already_refunded' })
  })
})

describe('clients from the environment', () => {
  it('uses fakes outside production and refuses to pretend in production', async () => {
    const dev = createClientsFromEnv({ NODE_ENV: 'development' })
    expect(dev.modes).toEqual({
      stripe: 'fake',
      instaradar: 'fake',
      linear: 'fake',
      authAdmin: 'fake',
    })
    const prod = createClientsFromEnv({ NODE_ENV: 'production' })
    expect(prod.modes).toEqual({
      stripe: 'unconfigured',
      instaradar: 'unconfigured',
      linear: 'unconfigured',
      authAdmin: 'unconfigured',
    })
    let caught: unknown
    try {
      await prod.clients.stripe.retrieveSubscription('sub_1')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ProviderError)
    expect(formatActionError(caught, 'the subscription was not changed').message).toBe(
      'Stripe: not_configured: Stripe is not configured (STRIPE_SECRET_KEY) · the subscription was not changed',
    )
    expect(fakesAllowed({ NODE_ENV: 'production', EXECUTOR_USE_FAKES: 'true' })).toBe(true)
    expect(fakesAllowed({ NODE_ENV: 'development', EXECUTOR_USE_FAKES: 'false' })).toBe(false)
  })

  it('builds real adapters when the credentials are set', () => {
    const real = createClientsFromEnv({
      NODE_ENV: 'production',
      STRIPE_WRITE_KEY: 'rk_test_placeholder',
      LINEAR_WRITE_API_KEY: 'lin_api_placeholder',
      INSTARADAR_DB_WRITE_URL: 'postgresql://executor@127.0.0.1:1/instaradar',
      INSTARADAR_SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder',
    })
    expect(real.modes).toEqual({
      stripe: 'real',
      instaradar: 'real',
      linear: 'real',
      authAdmin: 'real',
    })
    // One key per service is enough; the *_WRITE_* names are the optional least-privilege variant.
    const single = createClientsFromEnv({
      NODE_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      LINEAR_API_KEY: 'lin_api_placeholder',
      INSTARADAR_DB_URL: 'postgresql://maelle@127.0.0.1:1/instaradar',
    })
    expect(single.modes).toMatchObject({ stripe: 'real', instaradar: 'real', linear: 'real' })
  })

  it('deletes a user from the InstaRadar tables children first, the profile last', () => {
    expect(USER_TABLES[0]).toEqual({ table: 'tracked_profiles', column: 'user_id' })
    expect(USER_TABLES[USER_TABLES.length - 1]).toEqual({ table: 'profile', column: 'id' })
    expect(USER_TABLES.map((t) => t.table)).toContain('subscription')
  })
})
