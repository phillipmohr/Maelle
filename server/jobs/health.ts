/**
 * Health checks over the recurring job heartbeats (IRDR-455): alert when a recurring job has not
 * succeeded for longer than its stale window (fetch_mail: 15 minutes), at most once per hour.
 * Consecutive-failure alerts and dead-letter alerts live in the runner.
 */
import type { NotifyFn } from '#shared/services'
import type { Db } from './db'
import { listHeartbeats, markAlerted } from './heartbeats'
import { defaultLog, safeNotify } from './runner'
import { RECURRING_JOBS } from './schedule'

const ALERT_COOLDOWN_MS = 60 * 60 * 1000

export async function checkHealth(
  db: Db,
  opts: { now?: Date; notify: NotifyFn; log?: (msg: string) => void },
): Promise<string[]> {
  const now = opts.now ?? new Date()
  const log = opts.log ?? defaultLog
  const alerts: string[] = []
  const heartbeats = await listHeartbeats(db)
  for (const def of RECURRING_JOBS) {
    if (!def.staleAfterSeconds) continue
    const hb = heartbeats.find((h) => h.job === def.type)
    if (!hb) continue
    const reference = hb.last_succeeded_at ?? hb.created_at
    const staleMs = now.getTime() - reference.getTime()
    if (staleMs < def.staleAfterSeconds * 1000) continue
    if (hb.last_alert_at && now.getTime() - hb.last_alert_at.getTime() < ALERT_COOLDOWN_MS) continue
    const minutes = Math.round(staleMs / 60_000)
    await safeNotify(
      opts.notify,
      {
        title: `${def.type} has not succeeded for ${minutes} minutes`,
        detail: hb.last_error
          ? `Last error: ${hb.last_error}. Consecutive failures: ${hb.consecutive_failures}.`
          : 'No successful run has been recorded in that window.',
        source: 'jobs',
      },
      log,
    )
    await markAlerted(db, def.type, now)
    alerts.push(def.type)
  }
  return alerts
}
