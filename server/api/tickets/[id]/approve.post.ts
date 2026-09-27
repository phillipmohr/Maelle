/**
 * POST /api/tickets/:id/approve — owner: IRDR-457. Foundation stub: validates the shape, enforces the
 * confirmIrreversible 409, and answers with a pretend execution list from the seed proposal. Nothing
 * is persisted or executed.
 */
import type { ApproveRequest, ApproveResponse, ConfirmRequiredResponse } from '#shared/api'
import { ACTIONS, isActionType, safeParseActionParams } from '#shared/actions'
import { seedTicketDetail } from '#shared/seed/views'
import { seedBundle, stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(
  async (event): Promise<ApproveResponse | ConfirmRequiredResponse> => {
    stubHeaders(event, 'IRDR-457')
    const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
    const detail = seedTicketDetail(seedBundle(), id)
    if (!detail?.proposal)
      throw createError({ statusCode: 404, statusMessage: 'Ticket or proposal not found' })
    const body = await readBody<ApproveRequest>(event)
    if (!body || typeof body.proposalVersion !== 'number' || !Array.isArray(body.actions)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'proposalVersion and actions are required',
      })
    }
    if (body.proposalVersion !== detail.proposal.version) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Stale proposal version',
        data: { error: 'stale_version', current: detail.proposal.version },
      })
    }
    const merged = detail.proposal.actions.map((a) => {
      const edit = body.actions.find((x) => x.position === a.position)
      return { ...a, enabled: edit ? edit.enabled : a.enabled, params: edit?.params ?? a.params }
    })
    for (const added of body.addedActions ?? []) {
      if (!isActionType(added.type))
        throw createError({
          statusCode: 400,
          statusMessage: `Unknown action ${String(added.type)}`,
        })
    }
    for (const a of merged) {
      if (!a.enabled) continue
      const r = safeParseActionParams(a.type, a.params)
      if (!r.success)
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid params for ${a.type}`,
          data: r.error.issues,
        })
    }
    const irreversible = merged.filter(
      (a) => a.enabled && a.stage === 'now' && ACTIONS[a.type].irreversible,
    )
    if (irreversible.length > 0 && !body.confirmIrreversible) {
      setResponseStatus(event, 409)
      return {
        error: 'confirm_required',
        irreversible: irreversible.map((a) => ({
          position: a.position,
          type: a.type,
          effect: a.reason,
        })),
      }
    }
    return {
      decisionId: `stub-decision-${detail.ticket.displayNumber}`,
      ticketStatus: merged.some((a) => a.enabled && a.stage === 'after_confirmation')
        ? 'waiting_on_customer'
        : 'closed',
      executions: merged
        .filter((a) => a.enabled)
        .map((a) => ({
          executionId: `stub-exec-${a.position}`,
          type: a.type,
          status: a.stage === 'after_confirmation' ? 'queued' : 'succeeded',
          result: { stub: true },
        })),
    }
  },
)
