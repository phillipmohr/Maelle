/**
 * Registers the real job runner as `services.jobs` (IRDR-455) and the handlers for the timers this
 * ticket owns. Handlers that other plugins registered on the stub before this ran are adopted.
 */
import { registerTimerJobHandlers } from '../jobs/handlers'
import { createJobsService } from '../jobs/service'
import { registerService, services } from '../utils/services'

export default defineNitroPlugin(() => {
  const jobs = createJobsService({ adoptHandlersFrom: services.jobs })
  registerService('jobs', jobs)
  registerTimerJobHandlers(jobs, jobs.db)
})
