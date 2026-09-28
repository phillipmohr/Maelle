/**
 * Every /api route requires the allowed user's session. Cron routes are verified by CRON_SECRET,
 * webhook routes verify their own signature (see shared/api ROUTES).
 */
import { ROUTES } from '#shared/api'
import { requireAllowedUser, requireCronSecret } from '../utils/auth'

function routeAuth(path: string): 'session' | 'cron_secret' | 'signature' {
  const clean = path.split('?')[0] ?? path
  for (const r of ROUTES) {
    const pattern = new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+') + '/?$')
    if (pattern.test(clean)) return r.auth
  }
  if (clean.startsWith('/api/cron/')) return 'cron_secret'
  if (clean.startsWith('/api/webhooks/')) return 'signature'
  return 'session'
}

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/')) return
  if (path === '/api/health') return
  // Nuxt Supabase module callbacks and internal routes never come through here, but be explicit.
  if (path.startsWith('/api/_')) return

  const auth = routeAuth(path)
  if (auth === 'cron_secret') {
    requireCronSecret(event)
    return
  }
  if (auth === 'signature') return
  event.context.session = await requireAllowedUser(event)
})

declare module 'h3' {
  interface H3EventContext {
    session?: { email: string; userId: string | null; authDisabled: boolean }
  }
}
