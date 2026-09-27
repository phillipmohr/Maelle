/**
 * The `services.jobs` implementation (IRDR-455). Consumers only see the JobsService interface;
 * the runner, the schedule and the mail pipeline use the queue directly.
 */
import type { JobHandle, JobHandler, JobPayloads, JobType, JobsService } from '#shared/services'
import { JOB_TYPES } from '#shared/services'
import { poolDb, type Db } from './db'
import { JobQueue } from './queue'
import { handlerRegistry } from './registry'
import type { EnqueueOptions } from './types'

export interface JobsRuntime extends JobsService {
  readonly db: Db
  readonly queue: JobQueue
  /** Enqueue with runner options (dedupe key, attempts). */
  enqueueWith<T extends JobType>(
    type: T,
    payload: JobPayloads[T],
    opts: EnqueueOptions,
  ): Promise<JobHandle & { created: boolean }>
}

export function createJobsService(
  opts: { db?: Db; adoptHandlersFrom?: JobsService } = {},
): JobsRuntime {
  const db = opts.db ?? poolDb()
  const queue = new JobQueue(db)
  // Handlers registered on the stub before this plugin ran (plugin order is not guaranteed).
  if (opts.adoptHandlersFrom) {
    const handlers = handlerRegistry()
    for (const type of JOB_TYPES) {
      const h = opts.adoptHandlersFrom.getHandler(type)
      if (h && !handlers.has(type)) handlers.set(type, h as JobHandler)
    }
  }
  return {
    db,
    queue,
    async enqueue(type, payload, runAt) {
      const { job } = await queue.enqueue(type, payload, { runAt })
      return { id: job.id, type, runAt: job.run_at.toISOString() }
    },
    async enqueueWith(type, payload, options) {
      const { job, created } = await queue.enqueue(type, payload, options)
      return { id: job.id, type, runAt: job.run_at.toISOString(), created }
    },
    registerHandler(type, handler) {
      handlerRegistry().set(type, handler as JobHandler)
    },
    getHandler<T extends JobType>(type: T) {
      return handlerRegistry().get(type) as JobHandler<T> | undefined
    },
  }
}
