/**
 * Turns the seed bundle into the API shapes (`TicketListResponse`, `TicketDetailResponse`, …) so the
 * stubbed routes and the UI can work before the real endpoints exist.
 */
import type {
  ActionExecutionRow,
  AgentRunRow,
  DecisionRow,
  MessageRow,
  ProposalRow,
  ProposedActionRow,
  TicketDetailResponse,
  TicketListItem,
  TicketListResponse,
  TicketRow,
  UsageResponse,
} from '../api'
import { ACTIONS } from '../actions'
import {
  aggregateUsage,
  modelCallFromRow,
  ticketUsageFromRows,
  toolCallFromRow,
  type UsageWindow,
} from '../usage'
import type { CaseType } from '../case-types'
import type { SeedBundle } from './data'

type Row = Record<string, unknown>

function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** snake_case row → camelCase object. */
export function toCamel<T = Record<string, unknown>>(row: Row): T {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v
  return out as T
}

export function seedTicketRow(row: Row): TicketRow {
  return toCamel<TicketRow>(row)
}

export function seedProposalRow(bundle: SeedBundle, proposal: Row): ProposalRow {
  const p = toCamel<Record<string, unknown>>(proposal)
  const actions = bundle.proposed_actions
    .filter((a) => a.proposal_id === proposal.id)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((a) => {
      const c = toCamel<Record<string, unknown>>(a)
      return { ...c, type: a.action_type } as unknown as ProposedActionRow
    })
  return {
    ...(p as unknown as ProposalRow),
    reply: (proposal.reply_draft as ProposalRow['reply']) ?? null,
    actions,
  }
}

export function seedExecutionRow(row: Row): ActionExecutionRow {
  const c = toCamel<Record<string, unknown>>(row)
  return { ...c, type: row.action_type } as unknown as ActionExecutionRow
}

function whatRan(bundle: SeedBundle, ticketId: string): string | null {
  const ex = bundle.action_executions
    .filter((e) => e.ticket_id === ticketId && e.status === 'succeeded')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  if (ex.length === 0) return null
  const seen = new Set<string>()
  const parts: string[] = []
  for (const e of ex) {
    const t = e.action_type as keyof typeof ACTIONS
    if (seen.has(t)) continue
    seen.add(t)
    const refs = (e.external_refs ?? {}) as Record<string, string>
    const linked = (e.result as { linked?: boolean } | null)?.linked
    parts.push(
      t === 'create_linear_ticket' && refs.linearIssue
        ? `${ACTIONS[t].label}${linked ? ` (linked ${refs.linearIssue})` : ` ${refs.linearIssue}`}`
        : ACTIONS[t].label,
    )
  }
  return parts.join(' · ')
}

export function seedTicketList(bundle: SeedBundle, now: Date = new Date()): TicketListResponse {
  const items: TicketListItem[] = bundle.tickets.map((t) => {
    const ticket = seedTicketRow(t)
    const active =
      bundle.proposals
        .filter((p) => p.ticket_id === t.id)
        .sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null
    const run = bundle.agent_runs
      .filter((r) => r.ticket_id === t.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
    const decision = bundle.decisions
      .filter((d) => d.ticket_id === t.id)
      .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0]
    const actionCount = active
      ? bundle.proposed_actions.filter((a) => a.proposal_id === active.id && a.enabled !== false)
          .length
      : 0
    return {
      ...ticket,
      proposalLine: (active?.summary_line as string | undefined) ?? null,
      actionCount,
      runProgress:
        ticket.status === 'researching' && run ? (run.progress as AgentRunRow['progress']) : null,
      whatRan: whatRan(bundle, t.id as string),
      decision: (decision?.decision as TicketListItem['decision']) ?? null,
      decisionNote: (decision?.note as string | null) ?? null,
    }
  })
  const day = 24 * 3_600_000
  const closedSince = (ms: number) =>
    items.filter(
      (i) =>
        i.status === 'closed' && i.closedAt && now.getTime() - new Date(i.closedAt).getTime() < ms,
    ).length
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  return {
    items,
    nextCursor: null,
    counts: {
      needsDecision: items.filter((i) =>
        ['new', 'researching', 'needs_decision', 'executing', 'action_failed', 'manual'].includes(
          i.status,
        ),
      ).length,
      waitingOnCustomer: items.filter((i) => i.status === 'waiting_on_customer').length,
      snoozed: items.filter((i) => i.status === 'snoozed').length,
      autoPending: items.filter((i) => i.status === 'auto_pending').length,
      closedLast3Days: closedSince(3 * day),
      closedToday: items.filter(
        (i) => i.status === 'closed' && i.closedAt && new Date(i.closedAt) >= startOfToday,
      ).length,
    },
  }
}

export function seedTicketDetail(
  bundle: SeedBundle,
  idOrNumber: string,
): TicketDetailResponse | null {
  const t = bundle.tickets.find(
    (x) => x.id === idOrNumber || String(x.display_number) === idOrNumber.replace(/^#/, ''),
  )
  if (!t) return null
  const proposals = bundle.proposals
    .filter((p) => p.ticket_id === t.id)
    .sort((a, b) => (b.version as number) - (a.version as number))
  const [latest, ...older] = proposals
  return {
    ticket: seedTicketRow(t),
    messages: bundle.messages
      .filter((m) => m.ticket_id === t.id)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((m) => toCamel<MessageRow>(m)),
    proposal: latest ? seedProposalRow(bundle, latest) : null,
    previousProposals: older.map((p) => ({
      id: p.id as string,
      version: p.version as number,
      status: p.status as ProposalRow['status'],
      createdAt: p.created_at as string,
    })),
    executions: bundle.action_executions
      .filter((e) => e.ticket_id === t.id)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(seedExecutionRow),
    decisions: bundle.decisions
      .filter((d) => d.ticket_id === t.id)
      .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))
      .map((d) => toCamel<DecisionRow>(d)),
    runs: bundle.agent_runs
      .filter((r) => r.ticket_id === t.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((r) => toCamel<AgentRunRow>(r)),
    usage: ticketUsageFromRows(
      bundle.model_calls.filter((c) => c.ticket_id === t.id).map(modelCallFromRow),
      bundle.agent_tool_calls.filter((c) => c.ticket_id === t.id).map(toolCallFromRow),
    ),
  }
}

/** GET /api/usage from the seed (and from database rows loaded into a bundle). */
export function seedUsageResponse(bundle: SeedBundle, window: UsageWindow): UsageResponse {
  const tickets = new Map(bundle.tickets.map((t) => [t.id as string, t]))
  return aggregateUsage(
    window,
    bundle.model_calls.map(modelCallFromRow),
    bundle.agent_tool_calls.map(toolCallFromRow),
    (id) => {
      const t = tickets.get(id)
      return t
        ? {
            displayNumber: (t.display_number as number | null) ?? null,
            customerName: (t.customer_name as string | null) ?? null,
            caseType: (t.case_type as CaseType | null) ?? null,
          }
        : null
    },
  )
}
