/**
 * POST /api/tickets/:id/undo — owner: IRDR-457. Cancels the scheduled Auto reply inside the undo
 * window; the ticket returns to needs_decision and the response lists what already ran.
 */
import type { UndoResponse } from '#shared/api'
import { handled, ticketParam, useExecutor } from '../../../executor/http'

export default defineEventHandler(async (event): Promise<UndoResponse> => {
  const id = ticketParam(event)
  const executor = useExecutor()
  return handled(event, () => executor.undo(id))
})
