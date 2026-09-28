/** POST /api/tickets/:id/snooze — owner: IRDR-457. Safety tickets cannot be snoozed (422). */
import { handled, readValidatedBody, ticketParam, useExecutor } from '../../../executor/http'
import { SnoozeBodySchema } from '../../../executor/schemas'

export default defineEventHandler(async (event) => {
  const id = ticketParam(event)
  const executor = useExecutor()
  const body = await readValidatedBody(event, SnoozeBodySchema)
  const r = await handled(event, () => executor.snoozeTicket(id, new Date(body.until)))
  return { ok: true as const, ticketStatus: r.ticketStatus, snoozedUntil: r.snoozedUntil }
})
