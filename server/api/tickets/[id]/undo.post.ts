/** POST /api/tickets/:id/undo — owner: IRDR-457. Stub. */
import type { UndoResponse } from '#shared/api'
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler((event): UndoResponse => {
  stubHeaders(event, 'IRDR-457')
  return { cancelled: [], alreadyRan: [] }
})
