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
  return consistencyCheck(parsed.data, {
    model: smallModelClient(),
    modelId: agentRuntimeConfig().smallModel,
  })
})
