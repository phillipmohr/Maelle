/** Loads everything evaluate() looks at from Maelle's database. */
import type { ActionStage, ActionType } from '#shared/actions'
import type { AutonomyMode } from '#shared/api'
import type { CaseType, RiskLevel } from '#shared/case-types'
import { isCaseType } from '#shared/case-types'
import { dbOne, dbQuery, isDbConfigured } from '../utils/db'
import { iso, isUuid } from './app'
import type { EvaluateContext, EvaluateProposal, EvaluateTicket } from './evaluate'

type Row = Record<string, unknown>

export async function loadEvaluateContextFromDb(ticketId: string): Promise<EvaluateContext> {
  if (!isDbConfigured()) {
    return {
      ticket: null,
      proposal: null,
      mode: 'always_ask',
      globalPause: true,
      locks: {},
      databaseConfigured: false,
    }
  }
  const t = await dbOne<Row>(
    isUuid(ticketId)
      ? 'select * from public.tickets where id = $1'
      : 'select * from public.tickets where display_number = $1::int',
    [isUuid(ticketId) ? ticketId : ticketId.replace(/^#/, '')],
  )
  if (!t) return { ticket: null, proposal: null, mode: 'always_ask', globalPause: false, locks: {} }

  const ticket: EvaluateTicket = {
    id: String(t.id),
    displayNumber: Number(t.display_number),
    customerName: (t.customer_name as string | null) ?? null,
    customerEmail: String(t.customer_email),
    status: String(t.status),
    caseType: isCaseType(t.case_type) ? t.case_type : null,
    riskLevel: (t.risk_level as RiskLevel) ?? 'none',
    dueDate: t.due_date ? iso(t.due_date)!.slice(0, 10) : null,
  }

  const p = await dbOne<Row>(
    `select * from public.proposals where ticket_id = $1 and status = 'active' order by version desc limit 1`,
    [ticket.id],
  )
  let proposal: EvaluateProposal | null = null
  if (p) {
    const actions = await dbQuery<Row>(
      'select action_type, enabled, stage from public.proposed_actions where proposal_id = $1 order by position',
      [p.id],
    )
    proposal = {
      caseType: (isCaseType(p.case_type) ? p.case_type : 'unclear') as CaseType,
      riskLevel: (p.risk_level as RiskLevel) ?? 'none',
      policyWarnings: (p.policy_warnings as string[] | null) ?? [],
      customerConfirmationNeeded: Boolean(p.customer_confirmation_needed),
      stage: Number(p.stage) === 2 ? 2 : 1,
      actions: actions.map((a) => ({
        type: a.action_type as ActionType,
        enabled: a.enabled !== false,
        stage: (a.stage as ActionStage) ?? 'now',
      })),
    }
  }

  const caseType = proposal?.caseType ?? ticket.caseType
  const [modeRow, settings, lockRows] = await Promise.all([
    caseType
      ? dbOne<Row>('select mode from public.autonomy_modes where app_id = $1 and case_type = $2', [
          t.app_id,
          caseType,
        ])
      : Promise.resolve(null),
    dbOne<Row>('select global_pause from public.settings where app_id = $1', [t.app_id]),
    dbQuery<Row>('select action_type, locked from public.action_locks where app_id = $1', [
      t.app_id,
    ]),
  ])
  const locks: Partial<Record<ActionType, boolean>> = {}
  for (const l of lockRows) locks[l.action_type as ActionType] = Boolean(l.locked)

  return {
    ticket,
    proposal,
    mode: ((modeRow?.mode as AutonomyMode | undefined) ?? 'always_ask') as AutonomyMode,
    globalPause: Boolean(settings?.global_pause ?? false),
    locks,
    databaseConfigured: true,
  }
}
