/** Handlers for the recurring timers owned by this ticket (IRDR-455). */
import type { JobsService } from '#shared/services'
import type { Db } from './db'
import { runWaitingFollowUps, wakeSnoozed } from './timers'

export function registerTimerJobHandlers(jobs: JobsService, db: Db): void {
  jobs.registerHandler('wake_snoozed', async () => {
    await wakeSnoozed(db)
  })
  jobs.registerHandler('waiting_follow_up', async () => {
    await runWaitingFollowUps(db)
  })
}
