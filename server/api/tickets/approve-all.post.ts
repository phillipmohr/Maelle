/**
 * POST /api/tickets/approve-all — owner: IRDR-481. Approves and sends, as proposed, every ticket the
 * confirmation dialog showed that is still eligible and still on the same proposal version, one
 * after the other through `executor.approve(…, 'you')`. A failure is recorded and the rest go on.
 * 503 without a database or executor.
 */
import { z } from 'zod'
import type { ApproveAllResponse } from '#shared/api'
import { findRegenerableDrafts } from '../../agent/regenerate'
import { loadEvaluateContextFromDb } from '../../autonomy/context'
import { approveAll } from '../../executor/approve-all'
import { readValidatedBody, useExecutor } from '../../executor/http'

const ApproveAllBodySchema = z.object({
  tickets: z
    .array(
      z.object({
        ticketId: z.string().min(1).max(64),
        proposalVersion: z.number().int().nonnegative(),
      }),
    )
    .max(500),
})

export default defineEventHandler(async (event): Promise<ApproveAllResponse> => {
  const executor = useExecutor()
  const body = await readValidatedBody(event, ApproveAllBodySchema)
  return approveAll(
    {
      candidates: findRegenerableDrafts,
      loadContext: loadEvaluateContextFromDb,
      approve: (ticketId, input) => executor.approve(ticketId, input, 'you'),
    },
    body,
  )
})
