/**
 * POST /api/tickets/:id/approve — owner: IRDR-457.
 * Validates against the active proposal (version, registry, params), answers 409 with the list of
 * irreversible actions until `confirmIrreversible: true`, records the decision, runs the enabled
 * `now` actions in registry order with Send reply last, queues `after_confirmation` actions.
 */
import type { ApproveResponse, ConfirmRequiredResponse } from '#shared/api'
import { handled, readValidatedBody, ticketParam, useExecutor } from '../../../executor/http'
import { ApproveBodySchema } from '../../../executor/schemas'

export default defineEventHandler(
  async (event): Promise<ApproveResponse | ConfirmRequiredResponse> => {
    const id = ticketParam(event)
    const executor = useExecutor()
    const body = await readValidatedBody(event, ApproveBodySchema)
    return handled(event, () => executor.approve(id, body, 'you'))
  },
)
