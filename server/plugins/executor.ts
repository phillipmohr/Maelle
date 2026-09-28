/**
 * Registers the executor (IRDR-457) as `services.executor` and the `run_due_scheduled` job handler.
 * Real external clients are built only when their credential is set; otherwise development gets the
 * in-memory fakes and production gets clients that fail with "<Provider> is not configured".
 */
import { createClientsFromEnv } from '../executor/clients'
import { createExecutorService } from '../executor/service'
import { registerService, services } from '../utils/services'

export default defineNitroPlugin(() => {
  const { clients, modes } = createClientsFromEnv()
  const executor = createExecutorService({ clients })
  registerService('executor', executor)

  const registerJob = () =>
    services.jobs.registerHandler('run_due_scheduled', async () => {
      await executor.runDueScheduled()
    })
  registerJob()
  // Nitro loads plugins in file order; the jobs plugin (IRDR-455) may replace the jobs service after
  // this one ran. Register again once every plugin has initialised.
  setTimeout(registerJob, 0)

  console.info(
    `[executor] registered · stripe: ${modes.stripe}, instaradar: ${modes.instaradar}, linear: ${modes.linear}, auth admin: ${modes.authAdmin}`,
  )
})
