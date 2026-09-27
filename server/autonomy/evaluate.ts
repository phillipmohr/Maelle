/**
 * autonomy.evaluate(ticketId): the verdict only ('auto' | 'ask'). The agent calls it after each
 * successful run and calls executor.runAuto itself when it gets 'auto' (never from here, so nothing
 * executes twice). It is also the hook for the high-risk alert: a safety or high-risk ticket sends
 * notify('high_risk_ticket') once per ticket (the notify service dedupes) before the verdict 'ask'.
 */
import { ACTIONS, type ActionStage, type ActionType } from '#shared/actions'
import type { CaseType, RiskLevel } from '#shared/case-types'
import type { AutonomyMode } from '#shared/api'
import type { AutonomyService, AutonomyVerdict, NotifyFn } from '#shared/services'

export interface EvaluateTicket {
  id: string
  displayNumber: number
  customerName: string | null
  customerEmail: string
  status: string
  caseType: CaseType | null
  riskLevel: RiskLevel
  dueDate: string | null
}

export interface EvaluateProposal {
  caseType: CaseType
  riskLevel: RiskLevel
  policyWarnings: string[]
  customerConfirmationNeeded: boolean
  stage: 1 | 2
  actions: { type: ActionType; enabled: boolean; stage: ActionStage }[]
}

export interface EvaluateContext {
  ticket: EvaluateTicket | null
  proposal: EvaluateProposal | null
  /** Mode of the ticket's case type. */
  mode: AutonomyMode
  globalPause: boolean
  /** action_locks rows; missing actions fall back to the registry default. */
  locks: Partial<Record<ActionType, boolean>>
  /** False when no database is configured: everything waits for you. */
  databaseConfigured?: boolean
}

export type EvaluateReason =
  | 'no_database'
  | 'not_found'
  | 'safety'
  | 'high_risk'
  | 'no_proposal'
  | 'unclear'
  | 'paused'
  | 'always_ask'
  | 'policy_warnings'
  | 'confirmation_pending'
  | 'locked_action'
  | 'no_actions'
  | 'auto'

export interface EvaluateResult {
  verdict: AutonomyVerdict
  reason: EvaluateReason
  detail: string
}

export function isRisky(level: RiskLevel): boolean {
  return level === 'high' || level === 'safety'
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { none: 0, high: 1, safety: 2 }
  return rank[a] >= rank[b] ? a : b
}

export function isLocked(type: ActionType, locks: Partial<Record<ActionType, boolean>>): boolean {
  return locks[type] ?? ACTIONS[type].lockedByDefault
}

/** The guards, in order. Pure, so the rules are unit-tested without a database. */
export function decide(ctx: EvaluateContext): EvaluateResult {
  const ask = (reason: EvaluateReason, detail: string): EvaluateResult => ({
    verdict: 'ask',
    reason,
    detail,
  })
  if (ctx.databaseConfigured === false) return ask('no_database', 'No database configured')
  const t = ctx.ticket
  if (!t) return ask('not_found', 'Ticket not found')
  const risk = maxRisk(t.riskLevel, ctx.proposal?.riskLevel ?? 'none')
  if (risk === 'safety') return ask('safety', 'Safety tickets always wait for you')
  if (risk === 'high') return ask('high_risk', 'High-risk tickets always wait for you')
  const p = ctx.proposal
  if (!p) return ask('no_proposal', 'No active proposal')
  const caseType = p.caseType ?? t.caseType
  if (!caseType || caseType === 'unclear') return ask('unclear', 'The case is unclear')
  if (ctx.globalPause) return ask('paused', 'Automation is paused')
  if (ctx.mode !== 'auto') return ask('always_ask', `${caseType} is on Always ask`)
  if (p.policyWarnings.length > 0) {
    return ask('policy_warnings', `${p.policyWarnings.length} policy warning(s)`)
  }
  if (p.customerConfirmationNeeded && p.stage === 1) {
    return ask('confirmation_pending', 'The customer has to confirm first')
  }
  const enabled = p.actions.filter((a) => a.enabled)
  if (enabled.length === 0) return ask('no_actions', 'Nothing to execute')
  const locked = enabled.filter((a) => isLocked(a.type, ctx.locks))
  if (locked.length > 0) {
    return ask('locked_action', `Locked for Auto: ${locked.map((a) => a.type).join(', ')}`)
  }
  return { verdict: 'auto', reason: 'auto', detail: 'Every guard passed' }
}

export interface AutonomyServiceDeps {
  loadContext: (ticketId: string) => Promise<EvaluateContext>
  /** Resolved at call time so the registered notify service is used, not the stub. */
  notify: () => NotifyFn
  siteUrl: () => string
  log?: (msg: string) => void
}

export interface AutonomyServiceImpl extends AutonomyService {
  evaluateDetailed(ticketId: string): Promise<EvaluateResult>
}

export function createAutonomyService(deps: AutonomyServiceDeps): AutonomyServiceImpl {
  const log = deps.log ?? ((msg) => console.info(msg))

  async function alert(ticket: EvaluateTicket, proposal: EvaluateProposal | null) {
    const riskLevel = maxRisk(ticket.riskLevel, proposal?.riskLevel ?? 'none')
    try {
      await deps.notify()('high_risk_ticket', {
        ticketId: ticket.id,
        displayNumber: ticket.displayNumber,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        caseType: proposal?.caseType ?? ticket.caseType ?? 'unclear',
        riskLevel,
        dueDate: ticket.dueDate,
        url: `${deps.siteUrl().replace(/\/$/, '')}/anastasai/t/${ticket.displayNumber}`,
      })
    } catch (e) {
      log(`[autonomy] high-risk alert failed for #${ticket.displayNumber}: ${(e as Error).message}`)
    }
  }

  async function evaluateDetailed(ticketId: string): Promise<EvaluateResult> {
    const ctx = await deps.loadContext(ticketId)
    const result = decide(ctx)
    if (ctx.ticket && (result.reason === 'safety' || result.reason === 'high_risk')) {
      await alert(ctx.ticket, ctx.proposal)
    }
    log(
      `[autonomy] evaluate ${ctx.ticket ? `#${ctx.ticket.displayNumber}` : ticketId}: ${result.verdict} (${result.reason}: ${result.detail})`,
    )
    return result
  }

  return {
    evaluateDetailed,
    async evaluate(ticketId) {
      return (await evaluateDetailed(ticketId)).verdict
    },
  }
}
