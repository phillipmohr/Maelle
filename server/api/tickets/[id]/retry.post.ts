/**
 * POST /api/tickets/:id/retry — owner: IRDR-457. Re-runs the failed actions (new attempt rows with
 * the same base idempotency key), then the held reply. Safe to press twice.
 */
import type { ApproveResponse } from '#shared/api'
import { handled, ticketParam, useExecutor } from '../../../executor/http'

export default defineEventHandler(async (event): Promise<ApproveResponse> => {
  const id = ticketParam(event)
  const executor = useExecutor()
  return handled(event, () => executor.retry(id))
})
