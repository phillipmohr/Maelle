/** POST /api/tickets/:id/unsnooze — owner: IRDR-457. Stub. */
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler((event) => {
  stubHeaders(event, 'IRDR-457')
  return { ok: true as const, ticketStatus: 'needs_decision' }
})
