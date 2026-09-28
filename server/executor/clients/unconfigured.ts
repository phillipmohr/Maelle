/**
 * Production without a credential: every call fails with a clear, retryable-after-config error
 * instead of pretending. The dev server and tests use the fakes instead (see ./index.ts).
 */
import { ProviderError, type Provider } from '../errors'
import type { AuthAdminClient } from './auth-admin'
import type { InstaradarWriteClient } from './instaradar'
import type { LinearWriteClient } from './linear'
import type { StripeWriteClient } from './stripe'

function notConfigured(provider: Provider, envName: string): () => never {
  return () => {
    throw new ProviderError(provider, `${provider} is not configured (${envName})`, {
      code: 'not_configured',
    })
  }
}

/** A proxy whose every method rejects with the not-configured error. */
function unconfigured<T extends object>(provider: Provider, envName: string): T {
  const fail = notConfigured(provider, envName)
  return new Proxy({} as T, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined
      return async () => fail()
    },
  })
}

export const unconfiguredStripe = () =>
  unconfigured<StripeWriteClient>('Stripe', 'STRIPE_SECRET_KEY')
export const unconfiguredInstaradar = () =>
  unconfigured<InstaradarWriteClient>('InstaRadar', 'INSTARADAR_DB_URL')
export const unconfiguredLinear = () => unconfigured<LinearWriteClient>('Linear', 'LINEAR_API_KEY')
export const unconfiguredAuthAdmin = () =>
  unconfigured<AuthAdminClient>('Supabase', 'INSTARADAR_SUPABASE_SERVICE_ROLE_KEY')
