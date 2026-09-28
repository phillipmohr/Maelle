/**
 * Data for the daily digest: everything handled automatically since the last digest, what needs a
 * decision, what is waiting, and failed executions.
 */
import type { ActionType } from '#shared/actions'
import type { CaseType, RiskLevel } from '#shared/case-types'
import { isCaseType } from '#shared/case-types'
import { dbQuery } from '../utils/db'
import { iso } from '../autonomy/app'

type Row = Record<string, unknown>

export interface DigestTicket {
  displayNumber: number
  customerName: string | null
  customerEmail: string
  caseType: CaseType | null
  at: string
}

export interface DigestData {
  since: string
  until: string
  timezone: string
  siteUrl: string
  autoHandled: (DigestTicket & { ran: ActionType[] })[]
  needsDecision: (DigestTicket & { status: string; riskLevel: RiskLevel; dueDate: string | null })[]
  waiting: (DigestTicket & { status: string; snoozedUntil: string | null })[]
  failures: {
    displayNumber: number
    customerName: string | null
    action: ActionType
    error: string | null
    at: string
  }[]
}

function ticketOf(r: Row, at: unknown): DigestTicket {
  return {
    displayNumber: Number(r.display_number),
    customerName: (r.customer_name as string | null) ?? null,
    customerEmail: String(r.customer_email),
    caseType: isCaseType(r.case_type) ? r.case_type : null,
    at: iso(at)!,
  }
}

export interface DigestOptions {
  since: string
  now: Date
  timezone: string
  siteUrl: string
}

export async function loadDigestData(appId: string, opts: DigestOptions): Promise<DigestData> {
  const until = opts.now.toISOString()
  const [auto, needs, waiting, failures] = await Promise.all([
    dbQuery<Row>(
      `select t.display_number, t.customer_name, t.customer_email, t.case_type, d.decided_at,
              coalesce((select array_agg(distinct e.action_type order by e.action_type)
                        from public.action_executions e
                        where e.ticket_id = t.id and e.executed_by = 'auto' and e.status = 'succeeded'), '{}') as ran
       from public.decisions d
       join public.tickets t on t.id = d.ticket_id
       where t.app_id = $1 and d.decision = 'auto' and d.decided_at > $2 and d.decided_at <= $3
       order by d.decided_at asc`,
      [appId, opts.since, until],
    ),
    dbQuery<Row>(
      `select display_number, customer_name, customer_email, case_type, status, risk_level, due_date, created_at
       from public.tickets
       where app_id = $1 and status in ('needs_decision','action_failed','manual')
       order by (risk_level = 'safety') desc, (risk_level = 'high') desc, created_at asc`,
      [appId],
    ),
    dbQuery<Row>(
      `select display_number, customer_name, customer_email, case_type, status, snoozed_until, updated_at
       from public.tickets
       where app_id = $1 and status in ('waiting_on_customer','snoozed','auto_pending')
       order by updated_at asc`,
      [appId],
    ),
    dbQuery<Row>(
      `select e.action_type, e.error, e.created_at, t.display_number, t.customer_name
       from public.action_executions e
       join public.tickets t on t.id = e.ticket_id
       where t.app_id = $1 and e.status = 'failed' and e.created_at > $2 and e.created_at <= $3
       order by e.created_at asc`,
      [appId, opts.since, until],
    ),
  ])
  return {
    since: opts.since,
    until,
    timezone: opts.timezone,
    siteUrl: opts.siteUrl,
    autoHandled: auto.map((r) => ({
      ...ticketOf(r, r.decided_at),
      ran: ((r.ran as string[] | null) ?? []) as ActionType[],
    })),
    needsDecision: needs.map((r) => ({
      ...ticketOf(r, r.created_at),
      status: String(r.status),
      riskLevel: (r.risk_level as RiskLevel) ?? 'none',
      dueDate: r.due_date ? iso(r.due_date)!.slice(0, 10) : null,
    })),
    waiting: waiting.map((r) => ({
      ...ticketOf(r, r.updated_at),
      status: String(r.status),
      snoozedUntil: iso(r.snoozed_until),
    })),
    failures: failures.map((r) => ({
      displayNumber: Number(r.display_number),
      customerName: (r.customer_name as string | null) ?? null,
      action: r.action_type as ActionType,
      error: (r.error as string | null) ?? null,
      at: iso(r.created_at)!,
    })),
  }
}

/** The local date in the settings timezone, the dedupe key of the daily digest. */
export function localDateKey(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}
