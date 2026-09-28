/**
 * Builds the external clients. A real adapter is constructed only when its credential is set: one
 * key per service (STRIPE_SECRET_KEY, INSTARADAR_DB_URL, LINEAR_API_KEY, shared with the agent's
 * read clients). The non-secret parts, such as the Linear team and the InstaRadar Supabase URL, are
 * fixed in `shared/config.ts`. Without a credential,
 * development and tests get the in-memory fake (so the
 * whole flow can be exercised end to end), production gets a client whose every call fails with
 * "<Provider> is not configured (<ENV>)": the executor never pretends.
 */
import { INSTARADAR, LINEAR } from '#shared/config'
import type { Clients } from '../types'
import { createFakeAuthAdmin, createSupabaseAuthAdmin, type FakeAuthAdmin } from './auth-admin'
import { seedDesignFakes } from './dev-seed'
import { createInstaradarWriteClient } from './instaradar'
import { createFakeInstaradar, type FakeInstaradar } from './instaradar-fake'
import { createLinearWriteClient } from './linear'
import { createFakeLinear, type FakeLinear } from './linear-fake'
import { createStripeWriteClient } from './stripe'
import { createFakeStripe, type FakeStripe } from './stripe-fake'
import {
  unconfiguredAuthAdmin,
  unconfiguredInstaradar,
  unconfiguredLinear,
  unconfiguredStripe,
} from './unconfigured'

export type ClientMode = 'real' | 'fake' | 'unconfigured'

export interface ClientsFromEnv {
  clients: Clients
  modes: Record<keyof Clients, ClientMode>
}

/** Fakes are allowed outside production, or when EXECUTOR_USE_FAKES=true says so explicitly (dev only). */
export function fakesAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.EXECUTOR_USE_FAKES === 'true') return true
  if (env.EXECUTOR_USE_FAKES === 'false') return false
  return env.NODE_ENV !== 'production'
}

export function createClientsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ClientsFromEnv {
  const allowFakes = fakesAllowed(env)
  const modes: Record<keyof Clients, ClientMode> = {
    stripe: 'unconfigured',
    instaradar: 'unconfigured',
    linear: 'unconfigured',
    authAdmin: 'unconfigured',
  }
  const pick = <T>(
    name: keyof Clients,
    envSet: boolean,
    real: () => T,
    fake: () => T,
    none: () => T,
  ): T => {
    if (envSet) {
      modes[name] = 'real'
      return real()
    }
    if (allowFakes) {
      modes[name] = 'fake'
      return fake()
    }
    return none()
  }
  const clients: Clients = {
    stripe: pick(
      'stripe',
      Boolean(env.STRIPE_SECRET_KEY),
      () => createStripeWriteClient(env.STRIPE_SECRET_KEY!),
      createFakeStripe,
      unconfiguredStripe,
    ),
    instaradar: pick(
      'instaradar',
      Boolean(env.INSTARADAR_DB_URL),
      () => createInstaradarWriteClient(env.INSTARADAR_DB_URL!),
      createFakeInstaradar,
      unconfiguredInstaradar,
    ),
    linear: pick(
      'linear',
      Boolean(env.LINEAR_API_KEY),
      () =>
        createLinearWriteClient(env.LINEAR_API_KEY!, {
          teamId: LINEAR.teamId,
          teamName: LINEAR.teamName,
        }),
      createFakeLinear,
      unconfiguredLinear,
    ),
    authAdmin: pick(
      'authAdmin',
      Boolean(env.INSTARADAR_SUPABASE_SERVICE_ROLE_KEY),
      () =>
        createSupabaseAuthAdmin(INSTARADAR.supabaseUrl, env.INSTARADAR_SUPABASE_SERVICE_ROLE_KEY!),
      createFakeAuthAdmin,
      unconfiguredAuthAdmin,
    ),
  }
  // The dev server gets the design's sample objects, so the seed tickets can be approved end to end.
  if (env.EXECUTOR_SEED_FAKES !== 'false') {
    seedDesignFakes({
      ...(modes.stripe === 'fake' ? { stripe: clients.stripe as FakeStripe } : {}),
      ...(modes.linear === 'fake' ? { linear: clients.linear as FakeLinear } : {}),
      ...(modes.instaradar === 'fake' ? { instaradar: clients.instaradar as FakeInstaradar } : {}),
      ...(modes.authAdmin === 'fake' ? { authAdmin: clients.authAdmin as FakeAuthAdmin } : {}),
    })
  }
  return { clients, modes }
}

/** All four fakes, for tests. */
export function createFakeClients() {
  const stripe = createFakeStripe()
  const instaradar = createFakeInstaradar()
  const linear = createFakeLinear()
  const authAdmin = createFakeAuthAdmin()
  const clients: Clients = { stripe, instaradar, linear, authAdmin }
  return { clients, stripe, instaradar, linear, authAdmin }
}
