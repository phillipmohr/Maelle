/** POST /api/tickets/:id/unsnooze — owner: IRDR-457. */
import { handled, ticketParam, useExecutor } from '../../../executor/http'

export default defineEventHandler(async (event) => {
  const id = ticketParam(event)
  const executor = useExecutor()
  const r = await handled(event, () => executor.unsnoozeTicket(id))
  return { ok: true as const, ticketStatus: r.ticketStatus }
})
