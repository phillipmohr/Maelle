/** POST /api/tickets/:id/reject — owner: IRDR-457. Records the reason; the ticket becomes manual. */
import { handled, readValidatedBody, ticketParam, useExecutor } from '../../../executor/http'
import { RejectBodySchema } from '../../../executor/schemas'

export default defineEventHandler(async (event) => {
  const id = ticketParam(event)
  const executor = useExecutor()
  const body = await readValidatedBody(event, RejectBodySchema)
  return handled(event, () => executor.rejectTicket(id, body.reason, body.note))
})
