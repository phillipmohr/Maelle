/**
 * Handler registry, process-global so every `createJobsService()` instance (and a Nitro plugin
 * that registered its handler before the jobs plugin ran) shares the same map.
 */
import type { JobHandler, JobType } from '#shared/services'

const g = globalThis as unknown as { __maelleJobHandlers?: Map<JobType, JobHandler> }

export function handlerRegistry(): Map<JobType, JobHandler> {
  if (!g.__maelleJobHandlers) g.__maelleJobHandlers = new Map()
  return g.__maelleJobHandlers
}

/** Tests only. */
export function resetJobHandlersForTests(): void {
  g.__maelleJobHandlers = undefined
}
