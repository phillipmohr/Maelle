/**
 * IRDR-459: registers services.autonomy (evaluate), services.notify and the `daily_digest` job
 * handler. Everything reads the database when SUPABASE_DB_URL is set and degrades safely without it
 * (evaluate answers 'ask', notifications are logged in memory).
 */
import { isDbConfigured } from '../utils/db'
import { registerService, services } from '../utils/services'
import { currentAppId } from '../autonomy/app'
import { loadEvaluateContextFromDb } from '../autonomy/context'
import { createAutonomyService } from '../autonomy/evaluate'
import { loadSettings } from '../autonomy/repo'
import { createNotify } from '../notify'
import { loadDigestData } from '../notify/digest'
import { createDbNotificationLog, createMemoryNotificationLog } from '../notify/log'

const DAY_MS = 24 * 3_600_000

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const siteUrl = () => config.public.siteUrl || 'http://localhost:3000'
  const log = isDbConfigured()
    ? createDbNotificationLog(currentAppId)
    : createMemoryNotificationLog()

  const notify = createNotify({
    sendSystemEmail: (to, subject, body) => services.mail.sendSystemEmail(to, subject, body),
    log,
    async recipient() {
      if (isDbConfigured()) {
        const settings = await loadSettings(await currentAppId())
        if (settings.notifyEmail) return settings.notifyEmail
      }
      return config.notifyEmail || process.env.NOTIFY_EMAIL || null
    },
    async digest() {
      if (!isDbConfigured()) throw new Error('The daily digest needs a database')
      const appId = await currentAppId()
      const settings = await loadSettings(appId)
      const now = new Date()
      const since =
        (await log.lastSentAt('daily_digest')) ?? new Date(now.getTime() - DAY_MS).toISOString()
      return loadDigestData(appId, { since, now, timezone: settings.timezone, siteUrl: siteUrl() })
    },
  })
  registerService('notify', notify)

  registerService(
    'autonomy',
    createAutonomyService({
      loadContext: loadEvaluateContextFromDb,
      notify: () => services.notify,
      siteUrl,
    }),
  )

  const registerDigestHandler = () =>
    services.jobs.registerHandler('daily_digest', async () => {
      await services.notify('daily_digest', {})
    })
  registerDigestHandler()
  // The jobs plugin (IRDR-455) may register the real JobsService after this plugin ran; register the
  // handler again once every plugin has loaded so it lands on the real service either way.
  setImmediate(registerDigestHandler)
})
