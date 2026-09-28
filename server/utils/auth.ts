import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { serverSupabaseUser } from '#supabase/server'

export interface SessionInfo {
  email: string
  userId: string | null
  /** True in dev when AUTH_DISABLED=true (no Supabase session). */
  authDisabled: boolean
}

/**
 * Resolves the signed-in user and checks the allow-list. Throws 401/403 otherwise.
 * In `nuxt dev` with AUTH_DISABLED=true it returns the allowed email without a session.
 */
export async function requireAllowedUser(event: H3Event): Promise<SessionInfo> {
  const config = useRuntimeConfig(event)
  const allowed = (config.allowedUserEmail || '').toLowerCase()

  if (import.meta.dev && config.authDisabled) {
    return { email: allowed || 'dev@maelle.local', userId: null, authDisabled: true }
  }

  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user?.email) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  }
  if (!allowed || user.email.toLowerCase() !== allowed) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This account is not allowed to use Maelle',
    })
  }
  return { email: user.email, userId: user.id, authDisabled: false }
}

/** Cron and internal job routes: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`. */
export function requireCronSecret(event: H3Event): void {
  const config = useRuntimeConfig(event)
  const secret = config.cronSecret
  const header = getHeader(event, 'authorization') || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const alt = getHeader(event, 'x-cron-secret') || ''
  if (!secret || (!secretsMatch(bearer, secret) && !secretsMatch(alt, secret))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid cron secret' })
  }
}

/** Constant-time comparison, so response timing never leaks how much of the secret matched. */
function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
