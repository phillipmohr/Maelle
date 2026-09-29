/** GET /api/mail/status — owner: IRDR-455. Live fetch, history import and classification progress. */
import type { MailStatusResponse } from '#shared/api'
import { mailStatus } from '../../mail/status'
import { requireMailContext } from './_context'

export default defineEventHandler(async (): Promise<MailStatusResponse> => {
  return mailStatus(requireMailContext())
})
