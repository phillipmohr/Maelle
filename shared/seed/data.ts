/**
 * Seed data from the design (`AnastasAI Screens.dc.html`), so UI work can start immediately.
 * Rows use database column names. Timestamps are relative to `now` so the inbox always looks alive.
 *
 * Tickets: #4825 Pioneer Valley Credit Union (chargeback), #4824 Tom Becker (cancellation),
 * #4822 Marco Bianchi (refund stage 1), #4809 Daniel Okafor (refund stage 2), #4820 Priya Nair
 * (failed action), #4819 Jonas Weber (data accuracy), #4828 Amélie Dupont (researching),
 * #4801 Kate Morgan (snoozed), plus the history and activity log rows.
 */
import { deterministicUuid as uid, executionIdempotencyKey } from '../utils/ids'
import type { ActionType } from '../actions'
import type { CaseType } from '../case-types'
import type { CustomerContext, ModelCallPurpose } from '../api'
import { MODELS } from '../config'
import { costUsd, type TokenUsage } from '../pricing'
import { estimateContextTokens } from '../usage'

export const SEED_APP_ID = uid('app:instaradar')

type Row = Record<string, unknown>

export interface SeedBundle {
  apps: Row[]
  allowed_users: Row[]
  tickets: Row[]
  messages: Row[]
  agent_runs: Row[]
  proposals: Row[]
  proposed_actions: Row[]
  action_executions: Row[]
  decisions: Row[]
  release_notifications: Row[]
  cancellation_reasons: Row[]
  settings: Row[]
  autonomy_modes: Row[]
  action_locks: Row[]
  /** IRDR-460: one row per Claude call and per tool call of the agent loop. */
  model_calls: Row[]
  agent_tool_calls: Row[]
}

export const SEED_TABLE_ORDER: (keyof SeedBundle)[] = [
  'apps',
  'allowed_users',
  'settings',
  'autonomy_modes',
  'action_locks',
  'tickets',
  'messages',
  'agent_runs',
  'proposals',
  'proposed_actions',
  'action_executions',
  'decisions',
  'release_notifications',
  'cancellation_reasons',
  'model_calls',
  'agent_tool_calls',
]

const HOUR = 3_600_000
const DAY = 24 * HOUR

interface SeedAction {
  type: ActionType
  params: Record<string, unknown>
  reason: string
  stage?: 'now' | 'after_confirmation'
  requiredForReply?: boolean
  enabled?: boolean
}

interface SeedExecution {
  type: ActionType
  params: Record<string, unknown>
  by: 'you' | 'auto'
  status: 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'held' | 'cancelled'
  at: Date
  result?: unknown
  error?: string
  externalRefs?: Record<string, string>
  attempt?: number
  scheduledFor?: Date
  position?: number
}

export function buildSeed(now: Date = new Date(), allowedUserEmail?: string): SeedBundle {
  const t = now.getTime()
  const ago = (ms: number) => new Date(t - ms)
  const iso = (d: Date) => d.toISOString()
  const tomorrowAt = (h: number) => {
    const d = new Date(t + DAY)
    d.setHours(h, 0, 0, 0)
    return d
  }
  const dayAt = (daysAgo: number, h: number, m = 0) => {
    const d = new Date(t - daysAgo * DAY)
    d.setHours(h, m, 0, 0)
    return d
  }
  const year = now.getFullYear()
  const date = (m: number, d: number, y = year) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const bundle: SeedBundle = {
    apps: [
      {
        id: SEED_APP_ID,
        key: 'instaradar',
        name: 'InstaRadar',
        support_mailbox: 'support@instaradar.app',
      },
    ],
    allowed_users: allowedUserEmail ? [{ email: allowedUserEmail.toLowerCase() }] : [],
    tickets: [],
    messages: [],
    agent_runs: [],
    proposals: [],
    proposed_actions: [],
    action_executions: [],
    decisions: [],
    release_notifications: [],
    cancellation_reasons: [],
    model_calls: [],
    agent_tool_calls: [],
    settings: [
      {
        app_id: SEED_APP_ID,
        global_pause: false,
        undo_window_minutes: 10,
        digest_time: '08:00',
        timezone: 'Europe/Berlin',
        follow_up_days: 3,
        auto_close_days: 7,
        refund_daily_limit_count: 3,
        refund_daily_limit_amount_cents: 10_000,
        notify_email: null,
      },
    ],
    autonomy_modes: [
      {
        app_id: SEED_APP_ID,
        case_type: 'feature_request',
        mode: 'auto',
        changed_at: iso(new Date(`${date(9, 12)}T09:00:00Z`)),
      },
    ],
    action_locks: (
      ['refund_latest_payment', 'cancel_immediately', 'delete_account'] as ActionType[]
    ).map((a) => ({
      app_id: SEED_APP_ID,
      action_type: a,
      locked: true,
    })),
  }

  // ------------------------------------------------------------------ helpers

  interface TicketSpec {
    number: number
    email: string
    name: string | null
    subject: string
    status: string
    resolution?: string | null
    caseType: CaseType | null
    confidence?: number
    risk?: 'none' | 'high' | 'safety'
    riskReason?: string | null
    dueDate?: string | null
    stage?: 1 | 2
    waitingFor?: string | null
    snoozedUntil?: Date | null
    tags?: string[]
    instaradarUserId?: string | null
    stripeCustomerId?: string | null
    context?: CustomerContext | null
    createdAt: Date
    lastCustomerMessageAt?: Date
    closedAt?: Date | null
  }

  const ticketId = (n: number) => uid(`ticket:${n}`)

  function ticket(s: TicketSpec) {
    const id = ticketId(s.number)
    bundle.tickets.push({
      id,
      app_id: SEED_APP_ID,
      display_number: s.number,
      customer_email: s.email,
      customer_name: s.name,
      subject: s.subject,
      status: s.status,
      resolution: s.resolution ?? null,
      case_type: s.caseType,
      case_confidence: s.confidence ?? (s.caseType ? 0.94 : null),
      risk_level: s.risk ?? 'none',
      risk_reason: s.riskReason ?? null,
      due_date: s.dueDate ?? null,
      stage: s.stage ?? 1,
      waiting_for: s.waitingFor ?? null,
      snoozed_until: s.snoozedUntil ? iso(s.snoozedUntil) : null,
      tags: s.tags ?? [],
      instaradar_user_id: s.instaradarUserId ?? null,
      stripe_customer_id: s.stripeCustomerId ?? null,
      customer_context: s.context ?? null,
      first_message_at: iso(s.createdAt),
      last_message_at: iso(s.lastCustomerMessageAt ?? s.createdAt),
      last_customer_message_at: iso(s.lastCustomerMessageAt ?? s.createdAt),
      closed_at: s.closedAt ? iso(s.closedAt) : null,
      created_at: iso(s.createdAt),
      updated_at: iso(s.closedAt ?? s.lastCustomerMessageAt ?? s.createdAt),
    })
    return id
  }

  function message(
    ticketNumber: number,
    m: {
      direction: 'in' | 'out'
      from: string
      fromName?: string | null
      to: string
      subject: string
      text: string
      translation?: string | null
      at: Date
      sentBy?: 'you' | 'auto'
      attachments?: {
        name: string
        storagePath: string
        contentType?: string
        sizeBytes?: number
      }[]
      inReplyTo?: string | null
    },
  ) {
    const idx = bundle.messages.filter((x) => x.ticket_id === ticketId(ticketNumber)).length
    const id = uid(`message:${ticketNumber}:${idx}`)
    const rfc = `<seed-${ticketNumber}-${idx}@maelle.local>`
    bundle.messages.push({
      id,
      ticket_id: ticketId(ticketNumber),
      direction: m.direction,
      provider_message_id: `seed-${ticketNumber}-${idx}`,
      message_id: rfc,
      in_reply_to:
        m.inReplyTo ?? (idx > 0 ? `<seed-${ticketNumber}-${idx - 1}@maelle.local>` : null),
      references:
        idx > 0
          ? Array.from({ length: idx }, (_, i) => `<seed-${ticketNumber}-${i}@maelle.local>`)
          : [],
      from_email: m.from,
      from_name: m.fromName ?? null,
      to_emails: [m.to],
      cc_emails: [],
      subject: m.subject,
      text_body: m.text,
      html_body: null,
      translation: m.translation ?? null,
      attachments: m.attachments ?? [],
      raw_storage_path: null,
      received_at: m.direction === 'in' ? iso(m.at) : null,
      sent_at: m.direction === 'out' ? iso(m.at) : null,
      sent_by: m.direction === 'out' ? (m.sentBy ?? 'you') : null,
      created_at: iso(m.at),
    })
    return id
  }

  function run(
    ticketNumber: number,
    r: {
      trigger: string
      status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
      progress: Record<string, 'pending' | 'ok' | 'failed' | 'skipped'>
      startedAt: Date
      durationMs?: number
      error?: string
      index?: number
    },
  ) {
    const idx =
      r.index ?? bundle.agent_runs.filter((x) => x.ticket_id === ticketId(ticketNumber)).length
    const id = uid(`run:${ticketNumber}:${idx}`)
    const finished = r.durationMs != null ? new Date(r.startedAt.getTime() + r.durationMs) : null
    const usage =
      r.status === 'succeeded' || r.status === 'failed'
        ? agentCalls(id, ticketNumber, idx, r.status, r.startedAt, r.durationMs ?? 20_000, r.error)
        : null
    bundle.agent_runs.push({
      id,
      ticket_id: ticketId(ticketNumber),
      trigger: r.trigger,
      status: r.status,
      progress: r.progress,
      started_at: iso(r.startedAt),
      finished_at: finished ? iso(finished) : null,
      duration_ms: r.durationMs ?? null,
      model: MODELS.agent,
      input_tokens: usage?.inputTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
      cache_read_tokens: usage?.cacheReadTokens ?? null,
      cache_creation_tokens: usage?.cacheCreationTokens ?? null,
      cost_usd: usage?.costUsd ?? null,
      error: r.error ?? null,
      proposal_id: null,
      created_at: iso(r.startedAt),
    })
    return id
  }

  // ---------------------------------------------------------------- Claude calls (IRDR-460)

  /** The system prompt (protocol, templates, knowledge) is written to the cache on turn 1 and read after. */
  const SYSTEM_PROMPT_TOKENS = 9_600

  interface SeedTurn {
    input: number
    output: number
    /** tool, progress source, result size in characters, duration */
    tools: [string, string | null, number, number][]
    error?: string
  }

  const TOOL_INPUT: Record<string, (ticketNumber: number) => Record<string, unknown>> = {
    stripe_events: (n) => ({ customerId: `cus_seed${n}`, days: 400 }),
    instaradar_select: (n) => ({
      sql: `select plan, status, created_at from users where email = 'seed-${n}@example.com' limit 1`,
      purpose: 'plan and account status',
    }),
    notion_page: () => ({ pageId: '3e8c931f6ae581f3b55be4fc0ebd1597' }),
    vercel_logs: (n) => ({ userId: `usr_seed${n}`, sinceDays: 7, level: 'error' }),
    submit_proposal: () => ({}),
  }

  function modelCall(
    ticketNumber: number,
    c: {
      key: string
      purpose: ModelCallPurpose
      model: string
      at: Date
      usage: TokenUsage
      durationMs: number
      runId?: string | null
      turn?: number | null
      status?: 'ok' | 'refusal' | 'error'
      stopReason?: string | null
      error?: string | null
    },
  ): string {
    const id = uid(`model_call:${ticketNumber}:${c.key}`)
    const status = c.status ?? 'ok'
    bundle.model_calls.push({
      id,
      ticket_id: ticketId(ticketNumber),
      run_id: c.runId ?? null,
      purpose: c.purpose,
      model: c.model,
      turn: c.turn ?? null,
      attempt: c.runId ? 1 : null,
      status,
      stop_reason: c.stopReason ?? null,
      error: c.error ?? null,
      input_tokens: c.usage.inputTokens,
      cache_read_tokens: c.usage.cacheReadTokens,
      cache_creation_tokens: c.usage.cacheCreationTokens,
      output_tokens: c.usage.outputTokens,
      cost_usd: status === 'error' ? 0 : costUsd(c.model, c.usage),
      duration_ms: c.durationMs,
      created_at: iso(c.at),
    })
    return id
  }

  /** The turns of one agent run: research tools, then submit_proposal. Failed runs stop with an API error. */
  function agentCalls(
    runId: string,
    ticketNumber: number,
    runIndex: number,
    status: 'succeeded' | 'failed',
    startedAt: Date,
    durationMs: number,
    error?: string,
  ): TokenUsage & { costUsd: number | null } {
    const turns: SeedTurn[] =
      status === 'succeeded'
        ? [
            {
              input: 4_150,
              output: 360,
              tools: [
                ['stripe_events', 'stripe', 7_420, 640],
                ['instaradar_select', 'supabase', 2_610, 210],
              ],
            },
            { input: 7_020, output: 240, tools: [['notion_page', 'kb', 3_310, 480]] },
            { input: 8_140, output: 1_420, tools: [['submit_proposal', null, 18, 25]] },
          ]
        : [
            { input: 4_150, output: 360, tools: [['stripe_events', 'stripe', 7_420, 640]] },
            { input: 0, output: 0, tools: [], error: error ?? 'Model overloaded' },
          ]
    const total: TokenUsage & { costUsd: number | null } = {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }
    const slice = Math.round(durationMs / (turns.length + 1))
    turns.forEach((t, i) => {
      const turn = i + 1
      const at = new Date(startedAt.getTime() + slice * turn)
      const usage: TokenUsage = t.error
        ? { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 }
        : {
            inputTokens: t.input,
            cacheReadTokens: i === 0 ? 0 : SYSTEM_PROMPT_TOKENS,
            cacheCreationTokens: i === 0 ? SYSTEM_PROMPT_TOKENS : 0,
            outputTokens: t.output,
          }
      const callId = modelCall(ticketNumber, {
        key: `run${runIndex}:turn${turn}`,
        purpose: 'agent_turn',
        model: MODELS.agent,
        at,
        usage,
        durationMs: t.error ? 15_000 : slice - 400,
        runId,
        turn,
        status: t.error ? 'error' : 'ok',
        stopReason: t.error ? null : 'tool_use',
        error: t.error ?? null,
      })
      total.inputTokens += usage.inputTokens
      total.cacheReadTokens += usage.cacheReadTokens
      total.cacheCreationTokens += usage.cacheCreationTokens
      total.outputTokens += usage.outputTokens
      const cost = t.error ? 0 : costUsd(MODELS.agent, usage)
      total.costUsd = total.costUsd === null || cost === null ? null : total.costUsd + cost
      const measured = i < turns.length - 1 && !turns[i + 1]!.error
      t.tools.forEach(([tool, source, chars, ms], j) => {
        bundle.agent_tool_calls.push({
          id: uid(`tool_call:${ticketNumber}:run${runIndex}:turn${turn}:${j}`),
          run_id: runId,
          ticket_id: ticketId(ticketNumber),
          model_call_id: callId,
          turn,
          tool,
          source,
          ok: true,
          input: (TOOL_INPUT[tool] ?? (() => ({})))(ticketNumber),
          result_chars: chars,
          context_tokens: measured ? Math.round(chars / 3.6) : estimateContextTokens(chars),
          context_measured: measured,
          duration_ms: ms,
          created_at: iso(new Date(at.getTime() + 150 + j * ms)),
        })
      })
    })
    if (total.costUsd !== null) total.costUsd = Math.round(total.costUsd * 1_000_000) / 1_000_000
    return total
  }

  /** Two consistency checks while the reply was being edited (the small model). */
  function consistencyChecks(ticketNumber: number, decidedAt: Date) {
    for (const [i, secondsBefore] of [34, 9].entries()) {
      modelCall(ticketNumber, {
        key: `consistency:${decidedAt.getTime()}:${i}`,
        purpose: 'consistency_check',
        model: MODELS.small,
        at: new Date(decidedAt.getTime() - secondsBefore * 1000),
        usage: {
          inputTokens: 1_860 + i * 40,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 48,
        },
        durationMs: 1_900 + i * 300,
        stopReason: 'tool_use',
      })
    }
  }

  /** "Create KB draft": one condensation of the final reply (the small model). */
  function kbCondensation(ticketNumber: number, at: Date) {
    modelCall(ticketNumber, {
      key: `kb:${at.getTime()}`,
      purpose: 'kb_condensation',
      model: MODELS.small,
      at,
      usage: { inputTokens: 1_240, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 190 },
      durationMs: 3_400,
      stopReason: 'end_turn',
    })
  }

  interface ProposalSpec {
    version?: number
    runId?: string
    caseType: CaseType
    confidence?: number
    summary: string
    meta?: string
    risk?: 'none' | 'high' | 'safety'
    riskReason?: string | null
    dueDate?: string | null
    confirmationNeeded?: boolean
    stage?: 1 | 2
    research: {
      text: string
      sources: { kind: string; label: string; ref?: string; url?: string }[]
      evidence?: {
        timestamp: string
        event: string
        id?: string
        tone?: 'default' | 'bad' | 'muted'
      }[]
      logLines?: string[]
    }[]
    researchWarnings?: string[]
    policyWarnings?: string[]
    conclusion?: string | null
    reply: {
      template: string | null
      templateNotionPageId?: string | null
      to: string
      subject: string
      body: string
      attachments?: {
        name: string
        storagePath: string
        contentType?: string
        sizeBytes?: number
      }[]
    } | null
    knowledgeRefs?: {
      kind: 'template' | 'kb' | 'example' | 'protocol'
      notionPageId: string
      title: string
    }[]
    noKnowledgeFound?: boolean
    handoffReason?: string | null
    status?: 'active' | 'superseded' | 'decided'
    actions: SeedAction[]
    createdAt: Date
  }

  function proposal(ticketNumber: number, p: ProposalSpec) {
    const version = p.version ?? 1
    const id = uid(`proposal:${ticketNumber}:v${version}`)
    bundle.proposals.push({
      id,
      ticket_id: ticketId(ticketNumber),
      run_id: p.runId ?? null,
      version,
      case_type: p.caseType,
      confidence: p.confidence ?? 0.94,
      candidate_cases: [],
      summary_line: p.summary,
      meta_line: p.meta ?? null,
      risk_level: p.risk ?? 'none',
      risk_reason: p.riskReason ?? null,
      due_date: p.dueDate ?? null,
      customer_confirmation_needed: p.confirmationNeeded ?? false,
      stage: p.stage ?? 1,
      research: p.research.map((r) => ({
        text: r.text,
        sources: r.sources,
        evidence: (r.evidence ?? []).map((e) => ({
          timestamp: e.timestamp,
          event: e.event,
          id: e.id ?? '',
          tone: e.tone ?? 'default',
        })),
        logLines: r.logLines ?? [],
      })),
      research_warnings: p.researchWarnings ?? [],
      policy_warnings: p.policyWarnings ?? [],
      conclusion: p.conclusion ?? null,
      reply_draft: p.reply
        ? {
            template: p.reply.template,
            templateNotionPageId: p.reply.templateNotionPageId ?? null,
            to: p.reply.to,
            subject: p.reply.subject,
            body: p.reply.body,
            attachments: p.reply.attachments ?? [],
          }
        : null,
      knowledge_refs: p.knowledgeRefs ?? [],
      no_knowledge_found: p.noKnowledgeFound ?? false,
      handoff_reason: p.handoffReason ?? null,
      status: p.status ?? 'active',
      created_at: iso(p.createdAt),
    })
    p.actions.forEach((a, i) => {
      bundle.proposed_actions.push({
        id: uid(`proposed_action:${ticketNumber}:v${version}:${i}`),
        proposal_id: id,
        position: i,
        action_type: a.type,
        params: a.params,
        reason: a.reason,
        stage: a.stage ?? 'now',
        required_for_reply: a.requiredForReply ?? false,
        enabled: a.enabled ?? true,
        created_at: iso(p.createdAt),
      })
    })
    if (p.runId) {
      const r = bundle.agent_runs.find((x) => x.id === p.runId)
      if (r) r.proposal_id = id
    }
    return id
  }

  const IRREVERSIBLE: ActionType[] = [
    'refund_latest_payment',
    'cancel_immediately',
    'delete_account',
  ]

  function executions(
    ticketNumber: number,
    proposalId: string | null,
    version: number,
    list: SeedExecution[],
  ) {
    list.forEach((e, i) => {
      const position = e.position ?? i
      const attempt = e.attempt ?? 1
      const id = uid(`execution:${ticketNumber}:v${version}:${position}:${attempt}`)
      const key =
        executionIdempotencyKey(ticketId(ticketNumber), version, position) +
        (attempt > 1 ? `:a${attempt}` : '')
      bundle.action_executions.push({
        id,
        ticket_id: ticketId(ticketNumber),
        proposal_id: proposalId,
        proposed_action_id: proposalId
          ? uid(`proposed_action:${ticketNumber}:v${version}:${position}`)
          : null,
        action_type: e.type,
        params: e.params,
        executed_by: e.by,
        status: e.status,
        scheduled_for: e.scheduledFor ? iso(e.scheduledFor) : null,
        idempotency_key: key,
        attempt,
        result: e.result ?? null,
        error: e.error ?? null,
        external_refs: e.externalRefs ?? {},
        irreversible: IRREVERSIBLE.includes(e.type),
        started_at: iso(e.at),
        finished_at:
          e.status === 'queued' || e.status === 'scheduled' || e.status === 'held'
            ? null
            : iso(new Date(e.at.getTime() + 900)),
        created_at: iso(e.at),
        updated_at: iso(e.at),
      })
    })
  }

  function decision(
    ticketNumber: number,
    proposalId: string | null,
    d: {
      decision: string
      rejectReason?: string | null
      note?: string | null
      replyDiff?: unknown
      actionChanges?: unknown
      timeToDecideMs?: number
      at: Date
    },
  ) {
    bundle.decisions.push({
      id: uid(
        `decision:${ticketNumber}:${bundle.decisions.filter((x) => x.ticket_id === ticketId(ticketNumber)).length}`,
      ),
      ticket_id: ticketId(ticketNumber),
      proposal_id: proposalId,
      decision: d.decision,
      reject_reason: d.rejectReason ?? null,
      note: d.note ?? null,
      reply_diff: d.replyDiff ?? null,
      action_changes: d.actionChanges ?? null,
      time_to_decide_ms: d.timeToDecideMs ?? 38_000,
      decided_at: iso(d.at),
      created_at: iso(d.at),
    })
    if (d.decision === 'approved_with_edits') consistencyChecks(ticketNumber, d.at)
  }

  const SUPPORT = 'support@instaradar.app'
  const TPL = {
    cancellation_only: '3e8c931f6ae581429b0ecd9c9abee871',
    cancellation_reason_ask: '3e8c931f6ae58147b800e658bf20d6d7',
    refund_request: '3e8c931f6ae58118a872c601963e97c1',
    chargeback: '3e8c931f6ae5813c8558f2c0427a6037',
    bug_report: '3e8c931f6ae58114beabdeaddfaca242',
    data_accuracy: '3e8c931f6ae581f3b55be4fc0ebd1597',
    feature_request: '3e8c931f6ae581988be7cd93f5d89fd8',
    billing_question: '3e8c931f6ae581c894b8dd9ef534d00f',
    product_question: '3e8c931f6ae58193a3cdd3f12050625a',
    second_refund_request: '3e8c931f6ae58171ad14ff06d294b020',
    charged_after_cancellation: '3e8c931f6ae5810cb4cdfe335562081b',
    outage_access: '3e8c931f6ae5810fa4f4e479c2f418de',
  }

  // ------------------------------------------------------------------ #4825 Pioneer Valley Credit Union · chargeback · high risk

  {
    const n = 4825
    const created = ago(3 * HOUR)
    ticket({
      number: n,
      email: 'disputes@pvcu.org',
      name: 'Pioneer Valley Credit Union',
      subject: 'Disputed charges · case PV-2026-08812 · member Rachel Kim',
      status: 'needs_decision',
      caseType: 'chargeback',
      confidence: 0.97,
      risk: 'high',
      riskReason:
        'A credit union disputes 3 charges ($23.97) for its member Rachel Kim, who says she had cancelled. The reply is evidence, so review the wording.',
      dueDate: date(10, 7),
      tags: ['Long-term', 'Resubscribed'],
      instaradarUserId: 'usr_rkim_2f9a',
      stripeCustomerId: 'cus_RKim4417',
      createdAt: created,
      context: {
        title: 'Customer · Rachel Kim',
        plan: [
          { label: 'Plan', value: 'Pro Monthly' },
          { label: 'Status', value: 'Cancelled Aug 2' },
          { label: 'Customer since', value: 'Jan 12, 2026' },
          { label: 'Card', value: 'Visa ··4417', mono: true },
        ],
        timeline: [
          { date: 'Jan 12', label: 'Subscribed · Pro Monthly', amount: '$7.99', kind: 'default' },
          { date: 'Mar 18', label: 'Cancelled', amount: null, kind: 'muted' },
          { date: 'Apr 4', label: 'Resubscribed · Basic', amount: '$4.99', kind: 'default' },
          { date: 'Apr 20', label: 'Plan change → Pro', amount: '$7.99', kind: 'default' },
          { date: 'May 4', label: 'Charge · disputed', amount: '$7.99', kind: 'bad' },
          { date: 'Jun 4', label: 'Charge · disputed', amount: '$7.99', kind: 'bad' },
          { date: 'Jul 4', label: 'Charge · disputed', amount: '$7.99', kind: 'bad' },
          { date: 'Aug 2', label: 'Cancelled · final', amount: null, kind: 'muted' },
        ],
        trackedProfiles: [
          { handle: '@kimbakes.co', meta: 'since Apr 4' },
          { handle: '@lunchbox.rk', meta: 'since Apr 6' },
        ],
        previousTickets: [
          {
            id: uid('ticket:4410'),
            displayNumber: 4410,
            title: 'Story downloads not saving',
            date: 'Jun 12',
          },
        ],
        logErrors: null,
        logErrorsNote: 'None for this account',
        tags: ['Long-term', 'Resubscribed'],
      },
    })
    message(n, {
      direction: 'in',
      from: 'disputes@pvcu.org',
      fromName: 'Pioneer Valley Credit Union · Disputes',
      to: SUPPORT,
      subject: 'Disputed charges · case PV-2026-08812 · member Rachel Kim',
      text: 'To whom it may concern,\n\nOur member Rachel Kim has disputed three charges of $7.99 from InstaRadar dated May 4, June 4 and July 4, 2026, stating the subscription was cancelled three weeks before the first charge. Please provide documentation supporting these charges within 10 days, or refund them to avoid the formal chargeback process.\n\nCase reference: PV-2026-08812\n\nRegards,\nDisputes Team\nPioneer Valley Credit Union',
      at: created,
    })
    const r = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'skipped',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 20_000),
      durationMs: 22_000,
    })
    proposal(n, {
      runId: r,
      caseType: 'chargeback',
      confidence: 0.97,
      summary:
        'Contest the dispute with a formal reply, the payment timeline and proof of use. No refund.',
      meta: '1 action · formal template',
      risk: 'high',
      riskReason:
        'A credit union disputes 3 charges ($23.97) for its member Rachel Kim, who says she had cancelled. The reply is evidence, so review the wording.',
      dueDate: date(10, 7),
      research: [
        {
          text: 'Rachel cancelled her first subscription on Mar 18, then started a new one from the same account on Apr 4.',
          sources: [{ kind: 'stripe', label: 'Stripe · 6 events', ref: 'cus_RKim4417' }],
          evidence: [
            {
              timestamp: '2026-03-18 09:14',
              event: 'customer.subscription.deleted',
              id: 'sub_1OxK2a',
            },
            {
              timestamp: '2026-04-04 18:52',
              event: 'customer.subscription.created',
              id: 'sub_1P3mQe',
            },
            {
              timestamp: '2026-04-20 11:03',
              event: 'customer.subscription.updated',
              id: 'basic → pro',
            },
            {
              timestamp: '2026-08-29 07:40',
              event: 'charge.dispute.created',
              id: '3 × ch_… $7.99',
              tone: 'bad',
            },
          ],
        },
        {
          text: 'All three disputed charges belong to the new subscription, paid with Visa ··4417.',
          sources: [
            { kind: 'stripe', label: 'Stripe · ch_3PqL…', ref: 'ch_3PqL' },
            { kind: 'stripe', label: 'ch_3Q1n…', ref: 'ch_3Q1n' },
            { kind: 'stripe', label: 'ch_3QbZ…', ref: 'ch_3QbZ' },
          ],
        },
        {
          text: 'She signed in 41 times between May and August and kept 2 profiles tracked.',
          sources: [{ kind: 'supabase', label: 'Supabase · sessions', ref: 'sessions' }],
        },
        {
          text: 'She wrote to support on Jun 12 about story downloads, during the disputed period.',
          sources: [{ kind: 'email', label: 'Email history · #4410', ref: '4410' }],
        },
      ],
      conclusion:
        'The charges are valid. Rachel resubscribed herself and used the product while being billed.',
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.chargeback, title: 'Chargeback / bank dispute' },
      ],
      reply: {
        template: 'Chargeback response (formal)',
        templateNotionPageId: TPL.chargeback,
        to: 'disputes@pvcu.org',
        subject: 'Re: Disputed charges · case PV-2026-08812 · member Rachel Kim',
        body: 'Dear Pioneer Valley Credit Union Disputes Team,\n\nRegarding case PV-2026-08812 for your member Rachel Kim: the three charges of $7.99 on May 4, June 4 and July 4, 2026 are valid.\n\nMs. Kim cancelled her first subscription on March 18, 2026. On April 4 she started a new subscription from the same account, upgraded it on April 20, and was billed monthly until she cancelled again on August 2. During the disputed period she signed in 41 times and contacted our support on June 12 about a product feature.\n\nThe attached timeline lists each billing event with its date and ID. We ask that the dispute be resolved in our favor.\n\nKind regards,\nAnastasia\nCustomer Care, InstaRadar',
        attachments: [
          {
            name: 'stripe-timeline-rkim.png',
            storagePath: 'seed/4825/stripe-timeline-rkim.png',
            contentType: 'image/png',
            sizeBytes: 217_088,
          },
        ],
      },
      actions: [
        {
          type: 'send_reply',
          params: { to: 'disputes@pvcu.org', includeAttachments: true },
          reason: 'Because: the bank requests documentation within 10 days',
        },
      ],
      createdAt: new Date(created.getTime() + 42_000),
    })
  }

  // ------------------------------------------------------------------ #4824 Tom Becker · cancellation only · routine

  {
    const n = 4824
    const created = ago(6 * HOUR)
    ticket({
      number: n,
      email: 'tom.becker@web.de',
      name: 'Tom Becker',
      subject: 'Unsubscribe',
      status: 'needs_decision',
      caseType: 'cancellation_only',
      confidence: 0.98,
      instaradarUserId: 'usr_tbecker_71c0',
      stripeCustomerId: 'cus_TBecker0203',
      createdAt: created,
      context: {
        title: 'Customer',
        plan: [
          { label: 'Plan', value: 'Pro Monthly' },
          { label: 'Status', value: 'Active' },
          { label: 'Renews', value: 'Oct 14, 2026' },
          { label: 'Customer since', value: 'Feb 3, 2026' },
        ],
        timeline: [
          { date: 'Sep 14', label: 'Payment', amount: '$7.99', kind: 'default' },
          { date: 'Aug 14', label: 'Payment', amount: '$7.99', kind: 'default' },
          { date: 'Feb 3', label: 'Subscribed · Pro Monthly', amount: '$7.99', kind: 'default' },
        ],
        trackedProfiles: [
          { handle: '@berlin.eats', meta: 'since Feb 3' },
          { handle: '@tb.runs', meta: 'since Mar 9' },
        ],
        previousTickets: [],
        logErrors: null,
        logErrorsNote: 'None',
        tags: [],
      },
    })
    message(n, {
      direction: 'in',
      from: 'tom.becker@web.de',
      fromName: 'Tom Becker',
      to: SUPPORT,
      subject: 'Unsubscribe',
      text: 'Please unsubscribe me.',
      at: created,
    })
    const r = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'skipped',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 15_000),
      durationMs: 6_000,
    })
    proposal(n, {
      runId: r,
      caseType: 'cancellation_only',
      confidence: 0.98,
      summary: 'Cancel at period end, store the reason, send reply.',
      meta: '3 actions · all reversible',
      research: [
        {
          text: 'Active Pro Monthly subscription, renews Oct 14, 2026.',
          sources: [{ kind: 'stripe', label: 'Stripe · sub_1PzT8c', ref: 'sub_1PzT8c' }],
        },
        {
          text: 'No failed payments, refunds or open disputes.',
          sources: [{ kind: 'stripe', label: 'Stripe' }],
        },
        {
          text: 'No reason given. Stored as “Not stated”.',
          sources: [{ kind: 'email', label: 'Email history' }],
        },
      ],
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.cancellation_only, title: 'Cancellation only' },
      ],
      reply: {
        template: 'Cancellation only',
        templateNotionPageId: TPL.cancellation_only,
        to: 'tom.becker@web.de',
        subject: 'Re: Unsubscribe',
        body: "Hi Tom, thanks for reaching out!\n\nI've cancelled your subscription, so you won't be charged again. You keep full access to all Pro features until October 14, 2026.\n\nIf you don't mind me asking, what made you decide to cancel? I read every answer, and it helps us decide what to improve next.\n\nThanks for giving InstaRadar a try, you're always welcome back!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      actions: [
        {
          type: 'cancel_at_period_end',
          params: { stripeSubscriptionId: 'sub_1PzT8c', accessUntil: date(10, 14) },
          reason: 'Because: customer asked to unsubscribe',
        },
        {
          type: 'store_cancellation_reason',
          params: {
            stripeCustomerId: 'cus_TBecker0203',
            stripeSubscriptionId: 'sub_1PzT8c',
            feedback: 'other',
            comment: 'Not stated',
          },
          reason: 'Because: every cancellation is logged',
        },
        {
          type: 'send_reply',
          params: { to: 'tom.becker@web.de' },
          reason: 'Because: confirms the end date',
        },
      ],
      createdAt: new Date(created.getTime() + 21_000),
    })
  }

  // ------------------------------------------------------------------ #4822 Marco Bianchi · refund · stage 1

  {
    const n = 4822
    const created = ago(8 * HOUR)
    ticket({
      number: n,
      email: 'marco.bianchi@libero.it',
      name: 'Marco Bianchi',
      subject: 'Refund request',
      status: 'needs_decision',
      caseType: 'refund_request',
      confidence: 0.96,
      stage: 1,
      tags: ['New customer'],
      instaradarUserId: 'usr_mbianchi_9e11',
      stripeCustomerId: 'cus_MBianchi8820',
      createdAt: created,
      context: {
        title: 'Customer',
        plan: [
          { label: 'Plan', value: 'Pro Monthly' },
          { label: 'Status', value: 'Active' },
          { label: 'Customer since', value: 'Sep 15, 2026' },
          { label: 'Card', value: 'Mastercard ··8820', mono: true },
        ],
        timeline: [
          { date: 'Sep 15', label: 'Subscribed · Pro Monthly', amount: '$13.07', kind: 'default' },
        ],
        trackedProfiles: [
          { handle: '@marcobianchi', meta: 'since Sep 15' },
          { handle: '@trattoria.nonna', meta: 'since Sep 15' },
          { handle: '@mb.photo', meta: 'since Sep 16' },
          { handle: '@fc.lecco', meta: 'since Sep 18' },
        ],
        previousTickets: [],
        logErrors: null,
        logErrorsNote: 'None',
        tags: ['New customer'],
      },
    })
    message(n, {
      direction: 'in',
      from: 'marco.bianchi@libero.it',
      fromName: 'Marco Bianchi',
      to: SUPPORT,
      subject: 'Refund request',
      text: "Hi, I subscribed 12 days ago but the app isn't what I expected. Can I get a refund please?",
      at: created,
    })
    const r = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'skipped',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 12_000),
      durationMs: 8_000,
    })
    proposal(n, {
      runId: r,
      caseType: 'refund_request',
      confidence: 0.96,
      summary: 'Ask Marco to confirm, then refund $13.07 and cancel immediately.',
      meta: 'Now: 1 action · Queued: 2 irreversible',
      confirmationNeeded: true,
      stage: 1,
      research: [
        {
          text: 'Paid $13.07 on Sep 15 for Pro Monthly, including VAT.',
          sources: [{ kind: 'stripe', label: 'Stripe · pi_3QfA7x', ref: 'pi_3QfA7x' }],
        },
        {
          text: '12 days since payment, inside the 30-day window. No previous refunds.',
          sources: [
            { kind: 'stripe', label: 'Stripe' },
            { kind: 'kb', label: 'Knowledge base · Refund policy' },
          ],
        },
        {
          text: 'A refund closes the account and deletes 4 tracked profiles and their history, so Marco must confirm first.',
          sources: [
            { kind: 'kb', label: 'Knowledge base · Refund policy' },
            { kind: 'supabase', label: 'Supabase' },
          ],
        },
      ],
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.refund_request,
          title: 'Refund request (latest payment)',
        },
      ],
      reply: {
        template: 'Refund request (latest payment)',
        templateNotionPageId: TPL.refund_request,
        to: 'marco.bianchi@libero.it',
        subject: 'Re: Refund request',
        body: "Hi Marco, thanks for reaching out!\n\nI'd be happy to refund your latest payment of $13.07 from September 15. One important note first: a refund cancels your subscription immediately, and your tracking history for your 4 profiles is deleted right away. This can't be undone.\n\nJust reply “Yes, refund” to confirm and I'll process it straight away. The money then shows up on your statement within 5 to 10 business days, depending on your bank.\n\nIf you don't mind me asking, what made you decide to leave? I read every answer, and it genuinely helps us improve.\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      actions: [
        {
          type: 'refund_latest_payment',
          params: {
            stripePaymentIntentId: 'pi_3QfA7x',
            amountCents: 1307,
            currency: 'usd',
            paymentAmountCents: 1307,
            paymentDate: date(9, 15),
            cardLabel: 'Mastercard ··8820',
          },
          reason: 'Runs after Marco confirms · because: refund requested within 30 days',
          stage: 'after_confirmation',
        },
        {
          type: 'cancel_immediately',
          params: { stripeSubscriptionId: 'sub_1QfA7y', profilesAffected: 4 },
          reason: 'Runs after Marco confirms · required with a refund',
          stage: 'after_confirmation',
        },
        {
          type: 'send_reply',
          params: { to: 'marco.bianchi@libero.it' },
          reason: 'Runs now · explains data deletion and asks for a “Yes”',
        },
      ],
      createdAt: new Date(created.getTime() + 20_000),
    })
  }

  // ------------------------------------------------------------------ #4809 Daniel Okafor · refund · stage 2 (customer confirmed)

  {
    const n = 4809
    const created = ago(3 * DAY + 2 * HOUR)
    const stage1ReplyAt = ago(2 * DAY + 1 * HOUR)
    const confirmedAt = ago(1 * HOUR)
    ticket({
      number: n,
      email: 'd.okafor@proton.me',
      name: 'Daniel Okafor',
      subject: 'Refund',
      status: 'needs_decision',
      caseType: 'refund_request',
      confidence: 0.97,
      stage: 2,
      tags: ['Refund pending'],
      instaradarUserId: 'usr_dokafor_44b2',
      stripeCustomerId: 'cus_DOkafor2291',
      createdAt: created,
      lastCustomerMessageAt: confirmedAt,
      context: {
        title: 'Customer',
        plan: [
          { label: 'Plan', value: 'Pro Monthly' },
          { label: 'Status', value: 'Active' },
          { label: 'Customer since', value: 'Sep 9, 2026' },
          { label: 'Card', value: 'Visa ··2291', mono: true },
        ],
        timeline: [
          { date: 'Sep 9', label: 'Subscribed · Pro Monthly', amount: '$13.07', kind: 'default' },
        ],
        trackedProfiles: [
          { handle: '@okafor.designs', meta: 'since Sep 9' },
          { handle: '@lagos.lens', meta: 'since Sep 10' },
        ],
        previousTickets: [
          {
            id: ticketId(n),
            displayNumber: n,
            title: 'Stage 1 · asked to confirm',
            date: 'Sep 25',
          },
        ],
        logErrors: null,
        logErrorsNote: 'Unavailable · Vercel timeout',
        tags: ['Refund pending'],
      },
    })
    message(n, {
      direction: 'in',
      from: 'd.okafor@proton.me',
      fromName: 'Daniel Okafor',
      to: SUPPORT,
      subject: 'Refund',
      text: "Hello, I'd like a refund for my subscription. I signed up to check one profile and I'm done with it.",
      at: created,
    })
    message(n, {
      direction: 'out',
      from: SUPPORT,
      fromName: 'Anastasia · InstaRadar Support',
      to: 'd.okafor@proton.me',
      subject: 'Re: Refund',
      text: "Hi Daniel, thanks for reaching out!\n\nI'd be happy to refund your latest payment of $13.07 from September 9. One important note first: a refund cancels your subscription immediately, and your tracking history for @okafor.designs and @lagos.lens is deleted right away. This can't be undone.\n\nJust reply “Yes, refund” to confirm and I'll process it straight away. The money then shows up on your statement within 5 to 10 business days, depending on your bank.\n\nBest regards,\nAnastasia\nInstaRadar Support",
      at: stage1ReplyAt,
      sentBy: 'you',
    })
    message(n, {
      direction: 'in',
      from: 'd.okafor@proton.me',
      fromName: 'Daniel Okafor',
      to: SUPPORT,
      subject: 'Re: Refund',
      text: 'Yes, refund please. Thanks.',
      at: confirmedAt,
    })
    const r1 = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'skipped',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 15_000),
      durationMs: 7_000,
    })
    const p1 = proposal(n, {
      version: 1,
      runId: r1,
      caseType: 'refund_request',
      confidence: 0.97,
      summary: 'Ask Daniel to confirm, then refund $13.07 and cancel immediately.',
      meta: 'Now: 1 action · Queued: 2 irreversible',
      confirmationNeeded: true,
      stage: 1,
      status: 'decided',
      research: [
        {
          text: 'Paid $13.07 on Sep 9 for Pro Monthly. Inside the 30-day window, no previous refunds.',
          sources: [{ kind: 'stripe', label: 'Stripe · pi_3Qd2Lm', ref: 'pi_3Qd2Lm' }],
        },
      ],
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.refund_request,
          title: 'Refund request (latest payment)',
        },
      ],
      reply: {
        template: 'Refund request (latest payment)',
        templateNotionPageId: TPL.refund_request,
        to: 'd.okafor@proton.me',
        subject: 'Re: Refund',
        body: 'Hi Daniel, thanks for reaching out!\n\n(sent, see thread)',
      },
      actions: [
        {
          type: 'refund_latest_payment',
          params: {
            stripePaymentIntentId: 'pi_3Qd2Lm',
            amountCents: 1307,
            currency: 'usd',
            paymentDate: date(9, 9),
            cardLabel: 'Visa ··2291',
          },
          reason: 'Runs after Daniel confirms',
          stage: 'after_confirmation',
        },
        {
          type: 'cancel_immediately',
          params: { stripeSubscriptionId: 'sub_1Qd2Ln', profilesAffected: 2 },
          reason: 'Required with a refund',
          stage: 'after_confirmation',
        },
        {
          type: 'send_reply',
          params: { to: 'd.okafor@proton.me' },
          reason: 'Explains data deletion and asks for a “Yes”',
        },
      ],
      createdAt: new Date(created.getTime() + 22_000),
    })
    decision(n, p1, { decision: 'approved', at: stage1ReplyAt, timeToDecideMs: 41_000 })
    executions(n, p1, 1, [
      {
        position: 2,
        type: 'send_reply',
        params: { to: 'd.okafor@proton.me' },
        by: 'you',
        status: 'succeeded',
        at: stage1ReplyAt,
        result: { providerMessageId: 'seed-4809-1' },
      },
    ])
    const r2 = run(n, {
      trigger: 'customer_reply',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'failed',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(confirmedAt.getTime() + 10_000),
      durationMs: 5_000,
    })
    proposal(n, {
      version: 2,
      runId: r2,
      caseType: 'refund_request',
      confidence: 0.97,
      summary: 'Refund $13.07 and cancel immediately, then send confirmation.',
      meta: '3 actions · 2 irreversible',
      confirmationNeeded: false,
      stage: 2,
      researchWarnings: ['Vercel logs unavailable · not needed here'],
      research: [
        {
          text: 'Daniel replied “Yes, refund please” to our confirmation request from Sep 25.',
          sources: [{ kind: 'email', label: 'Email history · thread #4809', ref: '4809' }],
        },
        {
          text: 'Payment of $13.07 on Sep 9 is still refundable. No previous refunds.',
          sources: [{ kind: 'stripe', label: 'Stripe · pi_3Qd2Lm', ref: 'pi_3Qd2Lm' }],
        },
      ],
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.refund_request,
          title: 'Refund request (latest payment)',
        },
      ],
      reply: {
        template: 'Refund request (latest payment)',
        templateNotionPageId: TPL.refund_request,
        to: 'd.okafor@proton.me',
        subject: 'Re: Refund',
        body: "Hi Daniel,\n\nDone. I've refunded $13.07 to your Visa ending in 2291 and closed your account. The refund usually appears within 5 to 10 business days.\n\nThanks for giving InstaRadar a try.\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      actions: [
        {
          type: 'refund_latest_payment',
          params: {
            stripePaymentIntentId: 'pi_3Qd2Lm',
            amountCents: 1307,
            currency: 'usd',
            paymentAmountCents: 1307,
            paymentDate: date(9, 9),
            cardLabel: 'Visa ··2291',
          },
          reason: 'Because: customer confirmed on Sep 26',
        },
        {
          type: 'cancel_immediately',
          params: { stripeSubscriptionId: 'sub_1Qd2Ln', profilesAffected: 2 },
          reason: 'Because: required with a refund',
        },
        {
          type: 'send_reply',
          params: { to: 'd.okafor@proton.me' },
          reason: 'Because: confirms refund and closure',
        },
      ],
      createdAt: new Date(confirmedAt.getTime() + 16_000),
    })
  }

  // ------------------------------------------------------------------ #4820 Priya Nair · bug report · action failed

  {
    const n = 4820
    const created = ago(5 * HOUR)
    const executedAt = ago(2 * 60_000)
    ticket({
      number: n,
      email: 'priya.nair@gmail.com',
      name: 'Priya Nair',
      subject: 'False post deleted alerts',
      status: 'action_failed',
      caseType: 'bug_report',
      confidence: 0.95,
      tags: ['Long-term', 'Business plan'],
      instaradarUserId: 'usr_pnair_0b7d',
      stripeCustomerId: 'cus_PNair1009',
      createdAt: created,
      context: {
        title: 'Customer',
        plan: [
          { label: 'Plan', value: 'Business Yearly' },
          { label: 'Status', value: 'Active' },
          { label: 'Customer since', value: 'Nov 2, 2024' },
          { label: 'Card', value: 'Amex ··1009', mono: true },
        ],
        timeline: [
          {
            date: 'Nov 2, 2025',
            label: 'Renewal · Business Yearly',
            amount: '$179.00',
            kind: 'default',
          },
          {
            date: 'Nov 2, 2024',
            label: 'Subscribed · Business Yearly',
            amount: '$179.00',
            kind: 'default',
          },
        ],
        trackedProfiles: [
          { handle: '@studio.kolo', meta: '6 false alerts' },
          { handle: '@kolo.ceramics', meta: 'since Nov 2024' },
          { handle: '@priya.makes', meta: 'since Jan 2025' },
        ],
        previousTickets: [
          {
            id: uid('ticket:3977'),
            displayNumber: 3977,
            title: 'Export to CSV question',
            date: 'Mar 3',
          },
        ],
        logErrors: [
          { text: 'media 404 → post.deleted', count: 14 },
          { text: 'scan-worker retry exhausted', count: 3 },
        ],
        logErrorsNote: null,
        tags: ['Long-term', 'Business plan'],
      },
    })
    message(n, {
      direction: 'in',
      from: 'priya.nair@gmail.com',
      fromName: 'Priya Nair',
      to: SUPPORT,
      subject: 'False post deleted alerts',
      text: 'I keep getting post deleted alerts but nothing is deleted. It happened 6 times this week for @studio.kolo.',
      at: created,
    })
    const r = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: { stripe: 'ok', supabase: 'ok', vercel: 'ok', kb: 'ok', linear: 'ok', email: 'ok' },
      startedAt: new Date(created.getTime() + 10_000),
      durationMs: 17_000,
    })
    const p = proposal(n, {
      runId: r,
      caseType: 'bug_report',
      confidence: 0.95,
      summary: 'Link to INS-198, store Priya’s email for the fix, send reply.',
      meta: '1 of 3 ran · reply held back',
      status: 'decided',
      research: [
        {
          text: '14 errors since Sep 22 where a media 404 from Instagram was treated as a deletion for @studio.kolo.',
          sources: [{ kind: 'vercel', label: 'Vercel · scan-worker', ref: 'scan-worker' }],
          logLines: [
            '2026-09-22T06:14:02Z scan-worker WARN media 404 for @studio.kolo/3199004 → emitting post.deleted',
            '2026-09-23T06:14:11Z scan-worker WARN media 404 for @studio.kolo/3199004 → emitting post.deleted',
            '2026-09-24T06:15:40Z scan-worker ERROR retry exhausted for media 3199004',
          ],
        },
        {
          text: 'Known issue: false deletion alerts when the Instagram CDN returns 404.',
          sources: [{ kind: 'kb', label: 'Knowledge base · Known issues' }],
        },
        {
          text: 'INS-198 already covers this bug (open, 3 reports), so AnastasAI links it instead of creating a duplicate.',
          sources: [{ kind: 'linear', label: 'Linear · INS-198', ref: 'INS-198' }],
        },
      ],
      knowledgeRefs: [{ kind: 'template', notionPageId: TPL.bug_report, title: 'Bug report' }],
      reply: {
        template: 'Bug report',
        templateNotionPageId: TPL.bug_report,
        to: 'priya.nair@gmail.com',
        subject: 'Re: False post deleted alerts',
        body: "Hi Priya, thanks for reporting this!\n\nI looked into your account and our logs, and you're right: this is a bug on our side. A temporary error from Instagram is read as a deleted post, so nothing was actually deleted from @studio.kolo. I'm sorry for the confusion it caused.\n\nGood to know: this only affects the deletion alerts. Your follower list and activity timeline are still 100% accurate.\n\nI've passed it to our engineering team with your details, and I'll email you personally as soon as the fix is live. Thanks for helping us make InstaRadar better!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      actions: [
        {
          type: 'create_linear_ticket',
          params: {
            title: 'False “post deleted” alerts when Instagram CDN returns 404',
            description:
              'Customer report from priya.nair@gmail.com: 6 false alerts this week for @studio.kolo.',
            label: 'Bug',
            existingIssueIdentifier: 'INS-198',
            customerEmail: 'priya.nair@gmail.com',
          },
          reason: 'Added Priya’s report and email to the issue',
        },
        {
          type: 'store_release_notification_email',
          params: { linearIssueIdentifier: 'INS-198', email: 'priya.nair@gmail.com' },
          reason: 'Required by the reply, which promises a notice when it’s fixed',
          requiredForReply: true,
        },
        {
          type: 'send_reply',
          params: { to: 'priya.nair@gmail.com' },
          reason: 'Held until the required action succeeds',
        },
      ],
      createdAt: new Date(created.getTime() + 28_000),
    })
    decision(n, p, { decision: 'approved', at: executedAt, timeToDecideMs: 52_000 })
    executions(n, p, 1, [
      {
        type: 'create_linear_ticket',
        params: { existingIssueIdentifier: 'INS-198', customerEmail: 'priya.nair@gmail.com' },
        by: 'you',
        status: 'succeeded',
        at: executedAt,
        result: { linked: true, identifier: 'INS-198' },
        externalRefs: { linearIssue: 'INS-198', linearCommentId: 'cmt_7f31a' },
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-198', email: 'priya.nair@gmail.com' },
        by: 'you',
        status: 'failed',
        at: new Date(executedAt.getTime() + 1_000),
        error: 'Supabase: insert into release_notify timed out after 10s · req_8d1e42',
        externalRefs: { requestId: 'req_8d1e42' },
      },
      {
        type: 'send_reply',
        params: { to: 'priya.nair@gmail.com' },
        by: 'you',
        status: 'held',
        at: new Date(executedAt.getTime() + 1_500),
      },
    ])
  }

  // ------------------------------------------------------------------ #4819 Jonas Weber · data accuracy · KB reply only

  {
    const n = 4819
    const created = ago(1 * DAY + 3 * HOUR)
    ticket({
      number: n,
      email: 'jonas.weber@gmx.net',
      name: 'Jonas Weber',
      subject: 'Follower count does not add up',
      status: 'needs_decision',
      caseType: 'data_accuracy',
      confidence: 0.91,
      instaradarUserId: 'usr_jweber_5a2c',
      stripeCustomerId: 'cus_JWeber3310',
      createdAt: created,
      context: {
        title: 'Customer',
        plan: [
          { label: 'Plan', value: 'Basic Monthly' },
          { label: 'Status', value: 'Active' },
          { label: 'Renews', value: 'Oct 3, 2026' },
          { label: 'Customer since', value: 'Jul 3, 2026' },
        ],
        timeline: [
          { date: 'Sep 3', label: 'Payment', amount: '$4.99', kind: 'default' },
          { date: 'Aug 3', label: 'Payment', amount: '$4.99', kind: 'default' },
          { date: 'Jul 3', label: 'Subscribed · Basic Monthly', amount: '$4.99', kind: 'default' },
        ],
        trackedProfiles: [{ handle: '@weber.woodworks', meta: 'since Jul 3' }],
        previousTickets: [],
        logErrors: null,
        logErrorsNote: 'None',
        tags: [],
      },
    })
    message(n, {
      direction: 'in',
      from: 'jonas.weber@gmx.net',
      fromName: 'Jonas Weber',
      to: SUPPORT,
      subject: 'Follower count does not add up',
      text: "The follower count keeps going up but nothing new shows up. I don't trust that it's accurate.",
      at: created,
    })
    const r = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'ok',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 9_000),
      durationMs: 11_000,
    })
    proposal(n, {
      runId: r,
      caseType: 'data_accuracy',
      confidence: 0.91,
      summary: 'Explain the follower count lag with the scan-timing article. Reply only.',
      meta: '1 action · reply only',
      research: [
        {
          text: 'The tracked profile @weber.woodworks gained 38 followers this week; 31 are private accounts that never appear in the visible list.',
          sources: [{ kind: 'supabase', label: 'Supabase · follower_snapshots' }],
        },
        {
          text: 'Scans ran daily without errors.',
          sources: [{ kind: 'vercel', label: 'Vercel · scan-worker' }],
        },
        {
          text: 'Matching knowledge base entry: follower count fluctuation and private followers.',
          sources: [{ kind: 'kb', label: 'Knowledge base · Follower count fluctuation' }],
        },
      ],
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.data_accuracy, title: 'Data accuracy concern' },
      ],
      reply: {
        template: 'Data accuracy concern',
        templateNotionPageId: TPL.data_accuracy,
        to: 'jonas.weber@gmx.net',
        subject: 'Re: Follower count does not add up',
        body: "Hi Jonas, thanks for reaching out, I'd like to get to the bottom of this!\n\nI looked at @weber.woodworks: the count went up by 38 this week, and 31 of those new followers are private accounts. Instagram includes them in the total, but they never appear in the visible follower list, so the count moves while the list looks unchanged. Your list is accurate, it just cannot show private accounts.\n\nIf you saw something else that looked off, tell me where (the count at the top, the follower list, or an event in your timeline) and I'll check it right away.\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      actions: [
        {
          type: 'send_reply',
          params: { to: 'jonas.weber@gmx.net' },
          reason: 'Because: the answer is in the knowledge base, nothing to change on the account',
        },
      ],
      createdAt: new Date(created.getTime() + 22_000),
    })
  }

  // ------------------------------------------------------------------ #4828 Amélie Dupont · researching (French)

  {
    const n = 4828
    const created = ago(4 * 60_000)
    ticket({
      number: n,
      email: 'amelie.dupont@outlook.fr',
      name: 'Amélie Dupont',
      subject: 'Impossible de me connecter',
      status: 'researching',
      caseType: null,
      createdAt: created,
    })
    message(n, {
      direction: 'in',
      from: 'amelie.dupont@outlook.fr',
      fromName: 'Amélie Dupont',
      to: SUPPORT,
      subject: 'Impossible de me connecter',
      text: "Bonjour,\n\nDepuis hier soir je n'arrive plus à me connecter à mon compte et les profils que je suis ne se chargent pas. J'ai un abonnement Pro. Pouvez-vous m'aider ?\n\nMerci,\nAmélie",
      at: created,
    })
    run(n, {
      trigger: 'new_ticket',
      status: 'running',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'pending',
        kb: 'ok',
        linear: 'pending',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 8_000),
    })
  }

  // ------------------------------------------------------------------ #4801 Kate Morgan · billing question · snoozed

  {
    const n = 4801
    const created = ago(4 * DAY + 5 * HOUR)
    ticket({
      number: n,
      email: 'kate.morgan@yahoo.com',
      name: 'Kate Morgan',
      subject: 'Charged twice?',
      status: 'snoozed',
      caseType: 'billing_question',
      confidence: 0.9,
      snoozedUntil: tomorrowAt(9),
      instaradarUserId: 'usr_kmorgan_c1e8',
      stripeCustomerId: 'cus_KMorgan5540',
      createdAt: created,
      context: {
        title: 'Customer',
        plan: [
          { label: 'Plan', value: 'Pro Monthly' },
          { label: 'Status', value: 'Active' },
          { label: 'Renews', value: 'Oct 21, 2026' },
          { label: 'Customer since', value: 'Apr 21, 2026' },
        ],
        timeline: [
          { date: 'Sep 21', label: 'Payment', amount: '$7.99', kind: 'default' },
          {
            date: 'Sep 19',
            label: 'Catch-up payment (Aug 21 failed)',
            amount: '$7.99',
            kind: 'default',
          },
          { date: 'Aug 21', label: 'Payment failed', amount: '$7.99', kind: 'muted' },
        ],
        trackedProfiles: [{ handle: '@kate.morgan.art', meta: 'since Apr 21' }],
        previousTickets: [],
        logErrors: null,
        logErrorsNote: 'None',
        tags: [],
      },
    })
    message(n, {
      direction: 'in',
      from: 'kate.morgan@yahoo.com',
      fromName: 'Kate Morgan',
      to: SUPPORT,
      subject: 'Charged twice?',
      text: 'I see two charges of $7.99 within three days on my card statement. Was I charged twice for September?',
      at: created,
    })
    const r = run(n, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'skipped',
        kb: 'ok',
        linear: 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 10_000),
      durationMs: 9_000,
    })
    const p = proposal(n, {
      runId: r,
      caseType: 'billing_question',
      confidence: 0.9,
      summary: 'Explain the catch-up charge for the failed August payment. Reply only.',
      meta: '1 action · reply only',
      research: [
        {
          text: 'The Aug 21 payment failed (card declined) and was collected on Sep 19 as a catch-up payment; Sep 21 is the regular renewal.',
          sources: [{ kind: 'stripe', label: 'Stripe · in_1Qa9Xz', ref: 'in_1Qa9Xz' }],
        },
      ],
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.billing_question,
          title: 'Billing question / disputed charge',
        },
      ],
      reply: {
        template: 'Billing question / disputed charge',
        templateNotionPageId: TPL.billing_question,
        to: 'kate.morgan@yahoo.com',
        subject: 'Re: Charged twice?',
        body: "Hi Kate, thanks for reaching out, I understand why that looked unexpected!\n\nI checked your account: the $7.99 charge on September 19 is the payment for August 21 that your card declined at the time and that went through later, and the charge on September 21 is your regular Pro renewal. So you were billed once per month, just two days apart this time.\n\nYou can see every payment with its date on your billing page: https://www.instaradar.app/portal/settings/billing\n\nLet me know if anything still doesn't add up, I'm happy to take another look!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      actions: [
        {
          type: 'send_reply',
          params: { to: 'kate.morgan@yahoo.com' },
          reason: 'Because: both charges are legitimate',
        },
      ],
      createdAt: new Date(created.getTime() + 20_000),
    })
    decision(n, p, {
      decision: 'snoozed',
      note: 'Returns tomorrow at 09:00',
      at: ago(1 * DAY + 2 * HOUR),
      timeToDecideMs: 9_000,
    })
  }

  // ------------------------------------------------------------------ closed tickets (history + activity log)

  interface ClosedSpec {
    number: number
    email: string
    name: string
    subject: string
    customerText: string
    caseType: CaseType
    resolution: 'approved' | 'approved_with_edits' | 'rejected' | 'handled_manually' | 'auto'
    decisionNote?: string
    rejectReason?: 'wrong_case' | 'wrong_actions' | 'wrong_tone' | 'handle_myself'
    summary: string
    replyBody: string
    closedAt: Date
    actions: SeedAction[]
    executions: (Omit<SeedExecution, 'at' | 'by'> & { at?: Date; by?: 'you' | 'auto' })[]
    stage?: 1 | 2
    tags?: string[]
    releaseNotification?: { identifier: string }
    cancellationReason?: { feedback: string; comment: string }
  }

  function closed(c: ClosedSpec) {
    const created = new Date(c.closedAt.getTime() - 2 * HOUR)
    const by: 'you' | 'auto' = c.resolution === 'auto' ? 'auto' : 'you'
    // Knowledge-style answers got a KB draft after the reply (IRDR-460 seed rows).
    if (c.caseType === 'product_question' || c.caseType === 'data_accuracy')
      kbCondensation(c.number, new Date(c.closedAt.getTime() + 4 * 60_000))
    ticket({
      number: c.number,
      email: c.email,
      name: c.name,
      subject: c.subject,
      status: 'closed',
      resolution: c.resolution,
      caseType: c.caseType,
      stage: c.stage ?? 1,
      tags: c.tags ?? [],
      createdAt: created,
      closedAt: c.closedAt,
    })
    message(c.number, {
      direction: 'in',
      from: c.email,
      fromName: c.name,
      to: SUPPORT,
      subject: c.subject,
      text: c.customerText,
      at: created,
    })
    const r = run(c.number, {
      trigger: 'new_ticket',
      status: 'succeeded',
      progress: {
        stripe: 'ok',
        supabase: 'ok',
        vercel: 'skipped',
        kb: 'ok',
        linear: c.caseType === 'feature_request' || c.caseType === 'bug_report' ? 'ok' : 'skipped',
        email: 'ok',
      },
      startedAt: new Date(created.getTime() + 10_000),
      durationMs: 7_000,
    })
    const p = proposal(c.number, {
      runId: r,
      caseType: c.caseType,
      summary: c.summary,
      status: 'decided',
      stage: c.stage ?? 1,
      research: [
        {
          text: 'Researched from Stripe, Supabase and the knowledge base.',
          sources: [
            { kind: 'stripe', label: 'Stripe' },
            { kind: 'kb', label: 'Knowledge base' },
          ],
        },
      ],
      reply: { template: null, to: c.email, subject: `Re: ${c.subject}`, body: c.replyBody },
      actions: c.actions,
      createdAt: new Date(created.getTime() + 20_000),
    })
    const decisionKind =
      c.resolution === 'handled_manually'
        ? 'handled_manually'
        : c.resolution === 'rejected'
          ? 'rejected'
          : c.resolution
    decision(c.number, p, {
      decision: decisionKind,
      note: c.decisionNote ?? null,
      rejectReason: c.rejectReason ?? null,
      at: new Date(c.closedAt.getTime() - 60_000),
      timeToDecideMs: c.resolution === 'auto' ? null! : 38_000,
    })
    executions(
      c.number,
      p,
      1,
      c.executions.map((e, i) => ({
        ...e,
        by: e.by ?? by,
        at: e.at ?? new Date(c.closedAt.getTime() - (c.executions.length - i) * 1_000),
      })),
    )
    message(c.number, {
      direction: 'out',
      from: SUPPORT,
      fromName: 'Anastasia · InstaRadar Support',
      to: c.email,
      subject: `Re: ${c.subject}`,
      text: c.replyBody,
      at: c.closedAt,
      sentBy: by,
    })
    if (c.releaseNotification) {
      bundle.release_notifications.push({
        id: uid(`release_notification:${c.number}`),
        app_id: SEED_APP_ID,
        linear_issue_id: null,
        linear_issue_identifier: c.releaseNotification.identifier,
        email: c.email,
        ticket_id: ticketId(c.number),
        notified_at: null,
        created_at: iso(c.closedAt),
      })
    }
    if (c.cancellationReason) {
      bundle.cancellation_reasons.push({
        id: uid(`cancellation_reason:${c.number}`),
        ticket_id: ticketId(c.number),
        customer_email: c.email,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_feedback: c.cancellationReason.feedback,
        verbatim_reason: c.cancellationReason.comment,
        created_at: iso(c.closedAt),
      })
    }
  }

  const sendReply = (to: string, extra?: Record<string, unknown>): SeedAction => ({
    type: 'send_reply',
    params: { to, ...extra },
    reason: 'Because: the customer gets an answer',
  })

  // Today
  closed({
    number: 4818,
    email: 'liam.chen@icloud.com',
    name: 'Liam Chen',
    subject: 'Feature idea: date in file names',
    customerText:
      'Could downloaded files include the date and time in the file name? Right now everything is media.mp4.',
    caseType: 'feature_request',
    resolution: 'auto',
    summary: 'Create Linear ticket, store Liam’s email, send reply.',
    replyBody:
      "Hi Liam, thanks so much for the suggestion!\n\nAdding the date and time to downloaded file names is a great idea. I've added it to our roadmap with your email attached.\n\nI'll let you know personally as soon as it's live. And if anything else comes to mind, just reply to this email, I read every idea!\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(0, 7, 52),
    actions: [
      {
        type: 'create_linear_ticket',
        params: {
          title: 'Date and time in file names',
          description: 'Customer to notify once released: liam.chen@icloud.com',
          label: 'Feature',
          customerEmail: 'liam.chen@icloud.com',
        },
        reason: 'Because: feature request',
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-215', email: 'liam.chen@icloud.com' },
        reason: 'Because: the reply promises a release notice',
        requiredForReply: true,
      },
      sendReply('liam.chen@icloud.com'),
    ],
    executions: [
      {
        type: 'create_linear_ticket',
        params: { title: 'Date and time in file names', label: 'Feature' },
        status: 'succeeded',
        at: dayAt(0, 7, 42),
        result: { identifier: 'INS-215' },
        externalRefs: { linearIssue: 'INS-215' },
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-215', email: 'liam.chen@icloud.com' },
        status: 'succeeded',
        at: dayAt(0, 7, 42),
      },
      {
        type: 'send_reply',
        params: { to: 'liam.chen@icloud.com', note: 'after 10 min undo window' },
        status: 'succeeded',
        at: dayAt(0, 7, 52),
        scheduledFor: dayAt(0, 7, 52),
      },
    ],
    releaseNotification: { identifier: 'INS-215' },
  })
  closed({
    number: 4817,
    email: 'sofia.ruiz@gmail.com',
    name: 'Sofia Ruiz',
    subject: 'Suggestion',
    customerText: 'It would be great to export the follower changes of a week as a PDF report.',
    caseType: 'feature_request',
    resolution: 'approved',
    summary: 'Create Linear ticket, store Sofia’s email, send reply.',
    replyBody:
      "Hi Sofia, thanks so much for the suggestion!\n\nA weekly PDF report of follower changes is a great idea. I've added it to our roadmap with your email attached.\n\nI'll let you know personally as soon as it's live.\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(0, 7, 10),
    actions: [
      {
        type: 'create_linear_ticket',
        params: {
          title: 'Weekly PDF report of follower changes',
          description: 'Customer to notify once released: sofia.ruiz@gmail.com',
          label: 'Feature',
          customerEmail: 'sofia.ruiz@gmail.com',
        },
        reason: 'Because: feature request',
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-214', email: 'sofia.ruiz@gmail.com' },
        reason: 'Because: the reply promises a release notice',
        requiredForReply: true,
      },
      sendReply('sofia.ruiz@gmail.com'),
    ],
    executions: [
      {
        type: 'create_linear_ticket',
        params: { title: 'Weekly PDF report of follower changes', label: 'Feature' },
        status: 'succeeded',
        result: { identifier: 'INS-214' },
        externalRefs: { linearIssue: 'INS-214' },
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-214', email: 'sofia.ruiz@gmail.com' },
        status: 'succeeded',
      },
      { type: 'send_reply', params: { to: 'sofia.ruiz@gmail.com' }, status: 'succeeded' },
    ],
    releaseNotification: { identifier: 'INS-214' },
  })
  // Yesterday
  closed({
    number: 4816,
    email: 'aiko.tanaka@gmail.com',
    name: 'Aiko Tanaka',
    subject: 'Dark mode please',
    customerText: 'Any plans for a dark mode? The dashboard is very bright at night.',
    caseType: 'feature_request',
    resolution: 'auto',
    summary: 'Link to INS-209, store Aiko’s email, send reply.',
    replyBody:
      "Hi Aiko, thanks so much for the suggestion!\n\nDark mode is already on our roadmap, and I've added your email to it so you hear from me the moment it's live.\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(1, 22, 10),
    actions: [
      {
        type: 'create_linear_ticket',
        params: {
          title: 'Dark mode',
          description: 'Customer to notify once released: aiko.tanaka@gmail.com',
          label: 'Feature',
          existingIssueIdentifier: 'INS-209',
          customerEmail: 'aiko.tanaka@gmail.com',
        },
        reason: 'Because: an issue already exists, link it',
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-209', email: 'aiko.tanaka@gmail.com' },
        reason: 'Because: the reply promises a release notice',
        requiredForReply: true,
      },
      sendReply('aiko.tanaka@gmail.com'),
    ],
    executions: [
      {
        type: 'create_linear_ticket',
        params: { existingIssueIdentifier: 'INS-209' },
        status: 'succeeded',
        result: { linked: true, identifier: 'INS-209' },
        externalRefs: { linearIssue: 'INS-209' },
      },
      {
        type: 'store_release_notification_email',
        params: { linearIssueIdentifier: 'INS-209', email: 'aiko.tanaka@gmail.com' },
        status: 'succeeded',
      },
      {
        type: 'send_reply',
        params: { to: 'aiko.tanaka@gmail.com', note: 'after 10 min undo window' },
        status: 'succeeded',
      },
    ],
    releaseNotification: { identifier: 'INS-209' },
  })
  closed({
    number: 4815,
    email: 'h.schulz@t-online.de',
    name: 'Hannah Schulz',
    subject: 'Kündigung',
    customerText:
      'Hallo, ich möchte mein Abo kündigen. Es ist mir leider zu teuer geworden. Viele Grüße, Hannah',
    caseType: 'cancellation_reason_ask',
    resolution: 'approved_with_edits',
    decisionNote: 'Reply shortened',
    summary: 'Cancel at period end, store the reason, send reply.',
    replyBody:
      "Hi Hannah, thanks for reaching out!\n\nI've cancelled your subscription, so you won't be charged again. You keep full access until October 26, 2026.\n\nThanks for the honest feedback about the price, it helps. You're always welcome back!\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(1, 18, 22),
    actions: [
      {
        type: 'cancel_at_period_end',
        params: { stripeSubscriptionId: 'sub_1QhS2k', accessUntil: date(10, 26) },
        reason: 'Because: customer asked to cancel',
      },
      {
        type: 'store_cancellation_reason',
        params: { feedback: 'too_expensive', comment: 'Too expensive' },
        reason: 'Because: every cancellation is logged',
      },
      sendReply('h.schulz@t-online.de'),
    ],
    executions: [
      {
        type: 'cancel_at_period_end',
        params: { stripeSubscriptionId: 'sub_1QhS2k', accessUntil: date(10, 26) },
        status: 'succeeded',
        result: { accessUntil: date(10, 26) },
      },
      {
        type: 'store_cancellation_reason',
        params: { feedback: 'too_expensive', comment: 'Too expensive' },
        status: 'succeeded',
      },
      {
        type: 'send_reply',
        params: { to: 'h.schulz@t-online.de', note: 'edited' },
        status: 'succeeded',
      },
    ],
    cancellationReason: { feedback: 'too_expensive', comment: 'Too expensive' },
  })
  closed({
    number: 4814,
    email: 'omar.farouk@outlook.com',
    name: 'Omar Farouk',
    subject: 'Refund again',
    customerText: 'I need another refund, the last month was not useful for me.',
    caseType: 'second_refund_request',
    resolution: 'rejected',
    rejectReason: 'wrong_actions',
    decisionNote: 'Wrong actions · handled manually',
    summary: 'Ask for the reason before deciding on a second refund.',
    replyBody:
      "Hi Omar, thanks for reaching out!\n\nI see I already refunded a payment for you on July 3. Our no-questions-asked refund applies once per customer, so for a second refund I need to understand what happened first. Could you tell me what went wrong? If something on our side did not work as it should, I'll look into it right away and make it right.\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(1, 16, 5),
    actions: [sendReply('omar.farouk@outlook.com')],
    executions: [
      {
        type: 'send_reply',
        params: { to: 'omar.farouk@outlook.com', note: 'manual' },
        status: 'succeeded',
      },
    ],
  })
  closed({
    number: 4812,
    email: 'clara.novak@seznam.cz',
    name: 'Clara Novak',
    subject: 'Refund for my last charge',
    customerText: 'Yes, refund please.',
    caseType: 'refund_request',
    resolution: 'approved',
    stage: 2,
    summary: 'Refund $13.07 and cancel immediately, then send confirmation.',
    replyBody:
      "Hi Clara,\n\nDone. I've refunded $13.07 to your Visa ending in 5521 and closed your account. The refund usually appears within 5 to 10 business days.\n\nThanks for giving InstaRadar a try.\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(1, 11, 40),
    actions: [
      {
        type: 'refund_latest_payment',
        params: {
          stripePaymentIntentId: 'pi_3QeC9v',
          amountCents: 1307,
          currency: 'usd',
          cardLabel: 'Visa ··5521',
        },
        reason: 'Because: customer confirmed',
      },
      {
        type: 'cancel_immediately',
        params: { stripeSubscriptionId: 'sub_1QeC9w', profilesAffected: 3 },
        reason: 'Because: required with a refund',
      },
      sendReply('clara.novak@seznam.cz'),
    ],
    executions: [
      {
        position: 0,
        attempt: 1,
        type: 'refund_latest_payment',
        params: { amountCents: 1307, cardLabel: 'Visa ··5521' },
        status: 'failed',
        at: dayAt(1, 11, 39),
        error: 'Stripe: rate_limit (429) · nothing was charged or refunded · retried at 11:40',
        externalRefs: { requestId: 'req_Qx91Lm' },
      },
      {
        position: 0,
        attempt: 2,
        type: 'refund_latest_payment',
        params: { amountCents: 1307, cardLabel: 'Visa ··5521', note: 'retry' },
        status: 'succeeded',
        at: dayAt(1, 11, 40),
        result: { refundId: 're_3QeC9x' },
        externalRefs: { stripeRefund: 're_3QeC9x' },
      },
      {
        position: 1,
        type: 'cancel_immediately',
        params: { stripeSubscriptionId: 'sub_1QeC9w', profilesAffected: 3 },
        status: 'succeeded',
        at: dayAt(1, 11, 40),
        result: { deletedProfiles: 3 },
      },
      {
        position: 2,
        type: 'send_reply',
        params: { to: 'clara.novak@seznam.cz' },
        status: 'succeeded',
        at: dayAt(1, 11, 40),
      },
    ],
  })
  closed({
    number: 4811,
    email: 'ben.carter@proton.me',
    name: 'Ben Carter',
    subject: 'Private profiles',
    customerText:
      'The profile I want to track is private, but I follow them on Instagram. On a paid plan, will I be able to see their followers?',
    caseType: 'product_question',
    resolution: 'approved',
    summary: 'Explain that private profiles cannot be tracked. Reply only.',
    replyBody:
      "Hi Ben, thanks for reaching out, happy to help!\n\nPrivate profiles cannot be tracked on any plan, even if you follow them. InstaRadar only works with information that is publicly visible on Instagram, so a private account's follower list is not available to us.\n\nIf the account ever switches to public, you can start tracking it right away and every change from that day on is recorded.\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(1, 9, 3),
    actions: [sendReply('ben.carter@proton.me')],
    executions: [
      { type: 'send_reply', params: { to: 'ben.carter@proton.me' }, status: 'succeeded' },
    ],
  })
  // Two days ago
  closed({
    number: 4808,
    email: 'mia.rossi@libero.it',
    name: 'Mia Rossi',
    subject: 'Charged after I cancelled',
    customerText: 'I cancelled in August but was charged again on September 20. Please refund it.',
    caseType: 'charged_after_cancellation',
    resolution: 'approved_with_edits',
    decisionNote: 'Refund amount changed',
    summary: 'Stop the retries, refund the latest payment, send reply.',
    replyBody:
      "Hi Mia, thanks for reaching out, and sorry for the trouble!\n\nI looked into your account: a failed payment from before your cancellation went through on September 20. I've stopped all further payment attempts, so you won't be charged again, and I've refunded your latest payment of $7.99 from September 20. It shows up on your statement within 5 to 10 business days.\n\nSorry again for the confusion!\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(2, 20, 14),
    actions: [
      {
        type: 'stop_failed_payment_retries',
        params: { stripeCustomerId: 'cus_MRossi7712' },
        reason: 'Because: the subscription is cancelled',
      },
      {
        type: 'refund_latest_payment',
        params: { stripeChargeId: 'ch_3QgH1p', amountCents: 799, currency: 'usd' },
        reason: 'Because: charged after cancellation',
      },
      sendReply('mia.rossi@libero.it'),
    ],
    executions: [
      {
        type: 'stop_failed_payment_retries',
        params: { stripeCustomerId: 'cus_MRossi7712' },
        status: 'succeeded',
      },
      {
        type: 'refund_latest_payment',
        params: { amountCents: 799 },
        status: 'succeeded',
        result: { refundId: 're_3QgH1q' },
      },
      { type: 'send_reply', params: { to: 'mia.rossi@libero.it' }, status: 'succeeded' },
    ],
  })
  closed({
    number: 4806,
    email: 'lucas.martin@orange.fr',
    name: 'Lucas Martin',
    subject: 'Site down?',
    customerText: 'Nothing loads since this morning. Is the site down?',
    caseType: 'outage_access',
    resolution: 'handled_manually',
    rejectReason: 'handle_myself',
    decisionNote: "I'll handle it",
    summary: 'Explain the outage and confirm it is fixed. Reply only.',
    replyBody:
      "Hi Lucas, thanks for reaching out, and sorry for the trouble!\n\nWe had a technical issue this morning that stopped profiles from loading. It's fixed now, and everything is working normally again. Could you give it another try?\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(2, 13, 30),
    actions: [sendReply('lucas.martin@orange.fr')],
    executions: [
      {
        type: 'send_reply',
        params: { to: 'lucas.martin@orange.fr', note: 'manual' },
        status: 'succeeded',
      },
    ],
  })
  closed({
    number: 4805,
    email: 'eva.lindqvist@gmail.com',
    name: 'Eva Lindqvist',
    subject: 'Cancel',
    customerText: 'Please cancel my subscription, thanks.',
    caseType: 'cancellation_only',
    resolution: 'approved',
    summary: 'Cancel at period end, store the reason, send reply.',
    replyBody:
      "Hi Eva, thanks for reaching out!\n\nI've cancelled your subscription, so you won't be charged again. You keep full access to all Pro features until October 19, 2026.\n\nIf you don't mind me asking, what made you decide to cancel? I read every answer.\n\nBest regards,\nAnastasia\nInstaRadar Support",
    closedAt: dayAt(2, 8, 51),
    actions: [
      {
        type: 'cancel_at_period_end',
        params: { stripeSubscriptionId: 'sub_1QbL0e', accessUntil: date(10, 19) },
        reason: 'Because: customer asked to cancel',
      },
      {
        type: 'store_cancellation_reason',
        params: { feedback: 'other', comment: 'Not stated' },
        reason: 'Because: every cancellation is logged',
      },
      sendReply('eva.lindqvist@gmail.com'),
    ],
    executions: [
      {
        type: 'cancel_at_period_end',
        params: { stripeSubscriptionId: 'sub_1QbL0e', accessUntil: date(10, 19) },
        status: 'succeeded',
      },
      {
        type: 'store_cancellation_reason',
        params: { feedback: 'other', comment: 'Not stated' },
        status: 'succeeded',
      },
      { type: 'send_reply', params: { to: 'eva.lindqvist@gmail.com' }, status: 'succeeded' },
    ],
    cancellationReason: { feedback: 'other', comment: 'Not stated' },
  })

  return bundle
}

/** Display numbers of the open tickets from the design, for tests and stub routes. */
export const SEED_OPEN_TICKETS = [4825, 4824, 4822, 4809, 4820, 4819, 4828, 4801] as const
export const SEED_CLOSED_TICKETS = [
  4818, 4817, 4816, 4815, 4814, 4812, 4811, 4808, 4806, 4805,
] as const
