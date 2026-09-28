/**
 * POST /api/tickets/:id/manual-send — owner: IRDR-457. Runs the chosen actions and sends the
 * hand-written reply; resolution handled_manually ("I'll handle it") or rejected.
 */
import type { ApproveResponse, ConfirmRequiredResponse } from '#shared/api'
import { handled, readValidatedBody, ticketParam, useExecutor } from '../../../executor/http'
import { ManualSendBodySchema } from '../../../executor/schemas'

export default defineEventHandler(
  async (event): Promise<ApproveResponse | ConfirmRequiredResponse> => {
    const id = ticketParam(event)
    const executor = useExecutor()
    const body = await readValidatedBody(event, ManualSendBodySchema)
    return handled(event, () => executor.manualSend(id, body))
  },
)
