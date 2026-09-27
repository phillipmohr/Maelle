/**
 * Runs execution rows: registry order, Send reply last, one failure never stops an independent
 * action, the reply is held only while an action it requires has not succeeded. Every status change
 * is its own UPDATE so Realtime shows progress per action.
 */
import { ACTIONS, parseActionParams, sortByActionOrder } from '#shared/actions'
import type { ReplyDraft } from '#shared/proposal'
import type { MailService } from '#shared/services'
import { ZodError } from 'zod'
import { getHandler } from './actions'
import { formatActionError } from './errors'
import { baseKeyOf } from './keys'
import { updateExecution } from './repo'
import type { MaelleStore, Queryable } from './store'
import type {
  ActionContext,
  Clients,
  ExecutedBy,
  ExecutionRecord,
  ProposalRecord,
  SettingsRecord,
  TicketRecord,
} from './types'

export interface EngineDeps {
  db: () => Queryable
  clients: Clients
  store: MaelleStore
  mail: () => MailService
  now: () => Date
  log: (msg: string) => void
}

export interface RunInput {
  ticket: TicketRecord
  proposal: ProposalRecord | null
  /** Rows to run now (queued or held), one per position. */
  toRun: ExecutionRecord[]
  /** Every row of this decision scope, for prior results and the required-for-reply check. */
  scope: ExecutionRecord[]
  executedBy: ExecutedBy
  replyDraft: ReplyDraft | null
  customerConfirmed: boolean
  /** Auto: schedule the reply for this time instead of sending it. */
  scheduleReplyFor: Date | null
  settings: SettingsRecord
}

/** Newest attempt per base key. */
export function latestAttempts(rows: ExecutionRecord[]): ExecutionRecord[] {
  const byBase = new Map<string, ExecutionRecord>()
  for (const r of rows) {
    const base = baseKeyOf(r.idempotencyKey)
    const cur = byBase.get(base)
    if (!cur || r.attempt > cur.attempt) byBase.set(base, r)
  }
  return [...byBase.values()].sort((a, b) => a.position - b.position)
}

export function replyDraftOf(row: ExecutionRecord): ReplyDraft | null {
  const d = row.params.draft
  return d && typeof d === 'object' ? (d as ReplyDraft) : null
}

export async function runExecutions(deps: EngineDeps, input: RunInput): Promise<ExecutionRecord[]> {
  const ordered = sortByActionOrder(input.toRun)
  const scope = new Map(input.scope.map((e) => [e.id, e]))
  const priorResults = new Map<number, unknown>()
  for (const e of latestAttempts(input.scope)) {
    if (e.status === 'succeeded') priorResults.set(e.position, e.result)
  }
  const out: ExecutionRecord[] = []

  const baseCtx = (row: ExecutionRecord): ActionContext => ({
    ticket: input.ticket,
    proposal: input.proposal,
    executedBy: input.executedBy,
    idempotencyKey: baseKeyOf(row.idempotencyKey),
    attempt: row.attempt,
    clients: deps.clients,
    store: deps.store,
    settings: input.settings,
    mail: deps.mail(),
    now: deps.now,
    priorResults,
    customerConfirmed: input.customerConfirmed,
    replyDraft: input.replyDraft ?? replyDraftOf(row) ?? input.proposal?.replyDraft ?? null,
    scheduleReplyFor: input.scheduleReplyFor,
  })

  async function runOne(row: ExecutionRecord): Promise<ExecutionRecord> {
    const handler = getHandler(row.type)
    let current = await updateExecution(deps.db(), row.id, {
      status: 'running',
      startedAt: deps.now().toISOString(),
      finishedAt: null,
      error: null,
    })
    scope.set(current.id, current)
    try {
      let params: unknown
      try {
        params = parseActionParams(row.type, row.params)
      } catch (err) {
        if (err instanceof ZodError) {
          throw new Error(
            `Invalid params: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
            { cause: err },
          )
        }
        throw err
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = await handler.run(params as any, baseCtx(row))
      current = await updateExecution(deps.db(), row.id, {
        status: 'succeeded',
        result: outcome.result,
        error: null,
        externalRefs: { ...row.externalRefs, ...(outcome.externalRefs ?? {}) },
        finishedAt: deps.now().toISOString(),
      })
      priorResults.set(row.position, outcome.result)
      deps.log(`[executor] #${input.ticket.displayNumber} ${row.type} succeeded`)
    } catch (err) {
      const f = formatActionError(err, handler.consequence)
      current = await updateExecution(deps.db(), row.id, {
        status: 'failed',
        error: f.message,
        externalRefs: { ...row.externalRefs, ...f.externalRefs },
        finishedAt: deps.now().toISOString(),
      })
      deps.log(`[executor] #${input.ticket.displayNumber} ${row.type} failed: ${f.message}`)
    }
    scope.set(current.id, current)
    return current
  }

  for (const row of ordered) {
    if (row.type === 'send_reply') continue
    out.push(await runOne(row))
  }

  const reply = ordered.find((r) => r.type === 'send_reply')
  if (reply) {
    const latest = latestAttempts([...scope.values()])
    const blocking = latest.filter(
      (e) => e.type !== 'send_reply' && e.requiredForReply && e.status !== 'succeeded',
    )
    if (blocking.length > 0) {
      const waitingOn = blocking.map((e) => ACTIONS[e.type].label)
      out.push(
        await updateExecution(deps.db(), reply.id, {
          status: 'held',
          error: null,
          result: {
            held: true,
            waitingOn,
            note: `Not sent · waiting on “${waitingOn.join('”, “')}”`,
          },
          finishedAt: null,
        }),
      )
    } else if (input.scheduleReplyFor) {
      out.push(
        await updateExecution(deps.db(), reply.id, {
          status: 'scheduled',
          scheduledFor: input.scheduleReplyFor.toISOString(),
          error: null,
          result: { scheduled: true, undoUntil: input.scheduleReplyFor.toISOString() },
        }),
      )
    } else {
      out.push(await runOne(reply))
    }
  }
  return out
}
