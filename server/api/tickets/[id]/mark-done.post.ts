/** POST /api/tickets/:id/mark-done — owner: IRDR-457. Note required; resolution marked_done. */
import { handled, readValidatedBody, ticketParam, useExecutor } from '../../../executor/http'
import { MarkDoneBodySchema } from '../../../executor/schemas'

export default defineEventHandler(async (event) => {
  const id = ticketParam(event)
  const executor = useExecutor()
  const body = await readValidatedBody(event, MarkDoneBodySchema)
  const r = await handled(event, () => executor.markDoneTicket(id, body.note))
  return { ok: true as const, ticketStatus: r.ticketStatus, resolution: r.resolution }
})
