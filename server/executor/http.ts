/**
 * Helpers for the decision routes: the ticket param, body validation, the executor instance, and
 * the mapping from executor errors to HTTP. Routes stay thin; the service never sees h3.
 */
import { createError, getRouterParam, readBody, setResponseStatus, type H3Event } from 'h3'
import type { z } from 'zod'
import { InvalidTransitionError } from '#shared/status'
import { isDbConfigured } from '../utils/db'
import { isServiceRegistered, services } from '../utils/services'
import { ConfirmRequiredError } from './decision'
import { ExecutorError } from './errors'
import type { MaelleExecutor } from './service'

export function ticketParam(event: H3Event): string {
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Ticket id is required' })
  return id
}

export async function readValidatedBody<T extends z.ZodType>(
  event: H3Event,
  schema: T,
): Promise<z.output<T>> {
  const raw = await readBody<unknown>(event).catch(() => null)
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues
        .map((i) => `${i.path.map(String).join('.') || 'body'}: ${i.message}`)
        .join('; '),
      data: { error: 'invalid_body', issues: parsed.error.issues },
    })
  }
  return parsed.data
}

/** The registered executor, or 503 when the database or the service is missing. */
export function useExecutor(): MaelleExecutor {
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'The decision API needs a database. Set SUPABASE_DB_URL (or TEST_DATABASE_URL) and restart.',
      data: { error: 'db_not_configured' },
    })
  }
  if (!isServiceRegistered('executor')) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The executor service is not registered (server/plugins/executor.ts).',
      data: { error: 'executor_not_registered' },
    })
  }
  return services.executor as MaelleExecutor
}

/** Runs a service call and turns executor errors into HTTP errors with the shared shapes. */
export async function handled<T>(event: H3Event, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ConfirmRequiredError) {
      // 409 with the ConfirmRequiredResponse as the body; the UI then shows "Press A again…".
      setResponseStatus(event, 409)
      return err.body as unknown as T
    }
    if (err instanceof ExecutorError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message, data: err.data })
    }
    if (err instanceof InvalidTransitionError) {
      throw createError({
        statusCode: 409,
        statusMessage: `The ticket is ${err.from}; this step is not possible from there`,
        data: { error: 'invalid_transition', from: err.from, to: err.to },
      })
    }
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[executor] ${event.path} failed:`, err)
    throw createError({ statusCode: 500, statusMessage: `Executor failed: ${message}` })
  }
}
