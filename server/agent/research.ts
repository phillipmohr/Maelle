/**
 * Deterministic pre-research: every source in parallel, each with its own timeout, each reported to
 * `agent_runs.progress` as soon as it settles (so the UI checklist moves: Stripe ✓ Supabase ✓
 * Vercel ⋯). A failing source never blocks: it is marked failed with a research warning.
 */
import type { MessageRow, SourceStatus, TicketRow } from '#shared/api'
import { extractHandles, loadInstaradarBundle } from './tools/instaradar'
import { loadStripeBundle } from './tools/stripe'
import type { AgentTools } from './tools'
import type {
  InstaradarBundle,
  LinearIssueSummary,
  LogLine,
  PreviousTicketSummary,
  Progress,
  ProgressSource,
  ResearchBundle,
  SourceOutcome,
  StripeCustomerBundle,
} from './types'

export class SourceTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`)
    this.name = 'SourceTimeoutError'
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SourceTimeoutError(label, ms)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

const LABELS: Record<ProgressSource, string> = {
  stripe: 'Stripe',
  supabase: 'InstaRadar database',
  vercel: 'Vercel logs',
  kb: 'Knowledge base',
  linear: 'Linear',
  email: 'Email history',
}

/** Emails mentioned in a text (a bank names its member's address). */
export function extractEmails(text: string): string[] {
  const out = new Set<string>()
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[0].toLowerCase())
  return [...out]
}

/** Names mentioned next to "member", "customer", "cardholder", "client" or "account holder". */
export function extractNameHints(text: string): string[] {
  const out = new Set<string>()
  const re =
    /\b(?:member|customer|cardholder|card holder|client|account holder|subscriber)\s*[:,]?\s+((?:[A-Z][a-z'-]+\s){1,2}[A-Z][a-z'-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[1]!.trim())
  return [...out].slice(0, 3)
}

/** The ticket's customer email first, then every other email mentioned in the customer's messages. */
export function candidateEmailsFor(
  ticket: Pick<TicketRow, 'customerEmail'>,
  messages: MessageRow[],
): string[] {
  const text = messages
    .filter((m) => m.direction === 'in')
    .map((m) => `${m.subject ?? ''}\n${m.textBody ?? ''}`)
    .join('\n')
  const mentioned = extractEmails(text).filter(
    (e) => e !== ticket.customerEmail.toLowerCase() && !/@instaradar\.app$/.test(e),
  )
  return [ticket.customerEmail.toLowerCase(), ...mentioned].slice(0, 4)
}

export interface GatherArgs {
  ticket: TicketRow
  messages: MessageRow[]
  tools: AgentTools
  emailHistory: (emails: string[]) => Promise<PreviousTicketSummary[]>
  timeoutMs: number
  now: Date
  /** Called after every source settles with the full progress map. */
  onProgress: (progress: Progress) => Promise<void> | void
  /** Starting progress (kb may already be set by the caller). */
  initial?: Progress
}

export async function gatherResearch(args: GatherArgs): Promise<{
  bundle: ResearchBundle
  progress: Progress
  warnings: string[]
}> {
  const progress: Progress = {
    stripe: 'pending',
    supabase: 'pending',
    vercel: 'pending',
    kb: 'pending',
    linear: 'pending',
    email: 'pending',
    ...args.initial,
  }
  const warnings: string[] = []
  await args.onProgress({ ...progress })

  const inbound = args.messages.filter((m) => m.direction === 'in')
  const customerText = inbound.map((m) => `${m.subject ?? ''}\n${m.textBody ?? ''}`).join('\n')
  const emails = candidateEmailsFor(args.ticket, args.messages)
  const nameHints = extractNameHints(customerText)
  // @handles in the text, plus the sender's address local part (people write from firstname.lastname@).
  const localPart = args.ticket.customerEmail.split('@')[0]!.toLowerCase()
  const handles = [
    ...extractHandles(customerText),
    ...(/^[a-z0-9._]{3,30}$/.test(localPart) ? [localPart] : []),
  ].filter((h, i, all) => all.indexOf(h) === i)

  async function run<T>(
    source: ProgressSource,
    configured: boolean,
    fn: () => Promise<T>,
    unavailableNote = 'unavailable',
  ): Promise<SourceOutcome<T>> {
    const started = Date.now()
    const settle = async (status: SourceStatus, data: T | null, warning: string | null) => {
      progress[source] = status
      if (warning) warnings.push(warning)
      await args.onProgress({ ...progress })
      return { status, data, warning, durationMs: Date.now() - started }
    }
    if (!configured) return settle('skipped', null, `${LABELS[source]} not configured`)
    try {
      const data = await withTimeout(fn(), args.timeoutMs, LABELS[source])
      return settle('ok', data, null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return settle('failed', null, `${LABELS[source]} ${unavailableNote} (${msg})`)
    }
  }

  const email = args.ticket.customerEmail
  const stripeP = run<StripeCustomerBundle>('stripe', args.tools.stripe.configured, () =>
    loadStripeBundle(args.tools.stripe, emails, args.ticket.stripeCustomerId, nameHints),
  )
  const supabaseP = run<InstaradarBundle>('supabase', args.tools.instaradar.configured, () =>
    loadInstaradarBundle(args.tools.instaradar, emails, args.ticket.instaradarUserId, handles),
  )
  const emailP = run<PreviousTicketSummary[]>('email', true, () => args.emailHistory(emails))
  const linearQuery =
    `${args.ticket.subject ?? ''} ${inbound[0]?.textBody?.slice(0, 400) ?? ''}`.trim()
  const linearP = run<LinearIssueSummary[]>('linear', args.tools.linear.configured, () =>
    linearQuery ? args.tools.linear.searchIssues(linearQuery) : Promise.resolve([]),
  )
  // Vercel needs the user id or a handle to be useful; wait for the database first.
  const vercelP = (async () => {
    const ir = await supabaseP
    const userId = ir.data?.user?.id ?? args.ticket.instaradarUserId ?? null
    const handle = handles[0] ?? ir.data?.trackedProfiles[0]?.handle ?? null
    return run<LogLine[]>('vercel', args.tools.vercel.configured, async () => {
      const since = new Date(args.now.getTime() - 14 * 86_400_000).toISOString()
      const until = args.now.toISOString()
      const queries = []
      if (userId)
        queries.push(
          args.tools.vercel.search({ since, until, userId, level: 'warning', limit: 200 }),
        )
      if (handle)
        queries.push(
          args.tools.vercel.search({ since, until, handle, level: 'warning', limit: 200 }),
        )
      if (queries.length === 0)
        queries.push(
          args.tools.vercel.search({ since, until, text: email, level: 'warning', limit: 200 }),
        )
      const results = await Promise.all(queries)
      const seen = new Set<string>()
      const merged: LogLine[] = []
      for (const l of results.flat()) {
        const key = `${l.at}|${l.message}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(l)
      }
      return merged.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200)
    })
  })()

  const [stripe, supabase, vercel, linear, emailHistory] = await Promise.all([
    stripeP,
    supabaseP,
    vercelP,
    linearP,
    emailP,
  ])
  return {
    bundle: { stripe, supabase, vercel, linear, email: emailHistory },
    progress,
    warnings,
  }
}
