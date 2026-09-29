/**
 * POST /api/agent/consistency-check — owner: IRDR-456. Takes the current reply text and the enabled
 * actions, returns mismatches (the reply mentions a refund but the refund action is off, and so on).
 * Deterministic rules always run; the small model (MODELS.small) adds judgement when
 * ANTHROPIC_API_KEY is set.
 */
import { z } from 'zod'
import { ACTION_TYPES } from '#shared/actions'
import type { ConsistencyCheckResponse } from '#shared/api'
import { agentRuntimeConfig } from '../../agent/config'
import { consistencyCheck } from '../../agent/consistency'
import { createAnthropicModelClient } from '../../agent/model/anthropic'
import type { ModelClient } from '../../agent/model/types'
import { dbUsageSink } from '../../usage/db'
import { ticketIdOrNull } from '../../usage/record'
import { dbOne, isDbConfigured } from '../../utils/db'

const BodySchema = z.object({
  ticketId: z.string().default(''),
  replyBody: z.string().max(20_000).default(''),
  enabledActions: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
})

let smallModel: ModelClient | null | undefined

function smallModelClient(): ModelClient | null {
  if (smallModel !== undefined) return smallModel
  const key = agentRuntimeConfig().anthropicApiKey
  smallModel = key ? createAnthropicModelClient(key) : null
  return smallModel
}

export default defineEventHandler(async (event): Promise<ConsistencyCheckResponse> => {
  const parsed = BodySchema.safeParse((await readBody(event).catch(() => null)) ?? {})
  if (!parsed.success)
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    })
  const db = isDbConfigured()
  return consistencyCheck(
    { ...parsed.data, ticketId: db ? await resolveTicketId(parsed.data.ticketId) : '' },
    {
      model: smallModelClient(),
      modelId: agentRuntimeConfig().smallModel,
      usage: db ? dbUsageSink() : null,
    },
  )
})

/** The UI sends the display number or the uuid; the usage row needs the uuid (or nothing). */
async function resolveTicketId(ref: string): Promise<string> {
  const key = ref.trim().replace(/^#/, '')
  if (!key) return ''
  if (ticketIdOrNull(key)) return key
  if (!/^\d{1,9}$/.test(key)) return ''
  const row = await dbOne<{ id: string }>(
    `select id from public.tickets where display_number = $1`,
    [Number(key)],
  ).catch(() => null)
  return row?.id ?? ''
}
