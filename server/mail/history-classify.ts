/**
 * Classify-only pass over imported history tickets (IRDR-455). The history import closes every
 * old thread without an agent run; this pass gives each of those tickets a case so the closed
 * view and its per-case counts say what people write about. One short call per ticket on
 * MODELS.classify with low effort and a JSON schema; nothing is drafted, nothing is executed.
 *
 * Runs as the `classify_imported` job in chunks (MAILBOX.backfill.classifyChunkLimit per run),
 * re-enqueuing itself while tickets wait. Attempts per ticket are counted in
 * `ticket_classifications`; after classifyMaxAttempts a ticket is left without a case rather than
 * retried forever, and never dead-letters the queue.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { MailClassifyProgress } from '#shared/api'
import {
  CASE_TYPE_KEYS,
  CASE_TYPES,
  TEMPLATE_CASE_TYPES,
  UNCLEAR_CONFIDENCE_THRESHOLD,
  type CaseType,
} from '#shared/case-types'
import { MAILBOX, MODELS } from '#shared/config'
import type { Db } from '../jobs/db'
import { JobQueue } from '../jobs/queue'
import { errorMessage } from '../jobs/types'
import type { MailConfig } from './config'
import type { MailContext } from './context'
import { ticketIdOrNull, trackModelCall } from '../usage/record'
import type { UsageSink } from '../usage/types'

export interface ClassificationMessage {
  direction: 'in' | 'out'
  at: string | null
  text: string
}

export interface ClassificationInput {
  ticketId: string
  subject: string | null
  customerEmail: string
  customerName: string | null
  messages: ClassificationMessage[]
}

export const ClassificationSchema = z.object({
  caseType: z.enum(CASE_TYPE_KEYS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(600),
})
export type Classification = z.infer<typeof ClassificationSchema>

export interface HistoryClassifier {
  readonly kind: 'anthropic' | 'fake'
  readonly model: string | null
  classify(input: ClassificationInput): Promise<Classification>
}

// ---------------------------------------------------------------- prompt

/** Characters of thread text sent per ticket (oldest messages are dropped first, the first kept). */
export const MAX_THREAD_CHARS = 12_000
const MAX_MESSAGE_CHARS = 3_000

export function classificationSystemPrompt(): string {
  const lines: string[] = [
    'You classify one archived InstaRadar customer support thread into exactly one case type.',
    'InstaRadar is a subscription web app that shows public Instagram follower and following changes of profiles a customer tracks.',
    'The thread was handled long ago; you only label it for statistics. Do not draft a reply, do not propose actions.',
    'Judge by what the customer asked for in their first message and what the thread was about overall.',
    'Case types:',
  ]
  for (const key of TEMPLATE_CASE_TYPES) {
    const def = CASE_TYPES[key]
    lines.push(`- \`${key}\` (${def.label}): ${def.trigger}`)
  }
  lines.push(
    `- \`release_notification\`: only for a thread that is our own notice that a fix or feature shipped. Rare.`,
    `- \`unclear\`: the thread is empty, spam that slipped through, or not about the product.`,
    'Rules:',
    '- Prefer the most specific case: a refund request that also cancels is `refund_request`; cancel, refund and delete together is `cancellation_refund_deletion`.',
    '- A question about how something works is `product_question`; doubting the numbers is `data_accuracy`; something broken is `bug_report`; a wish for something new is `feature_request`.',
    '- `chargeback` is only for a bank or card issuer writing on behalf of the customer.',
    '- confidence is your probability that the label is right (0 to 1). Use `unclear` only when nothing fits; a low confidence on a real case is better than `unclear`.',
    '- rationale: one sentence, at most 40 words.',
  )
  return lines.join('\n')
}

export function classificationUserPrompt(input: ClassificationInput): string {
  const kept = trimThread(input.messages)
  const parts: string[] = [
    `Subject: ${input.subject ?? '(no subject)'}`,
    `Customer: ${input.customerName ? `${input.customerName} <${input.customerEmail}>` : input.customerEmail}`,
    `Messages: ${kept.length} of ${input.messages.length}`,
    '',
  ]
  for (const m of kept) {
    const who = m.direction === 'in' ? 'CUSTOMER' : 'SUPPORT'
    parts.push(`--- ${who}${m.at ? ` · ${m.at}` : ''} ---`, m.text, '')
  }
  return parts.join('\n')
}

/** Keeps the first message whole, then the most recent ones, within MAX_THREAD_CHARS. */
export function trimThread(messages: ClassificationMessage[]): ClassificationMessage[] {
  const clipped = messages.map((m) => ({
    ...m,
    text:
      m.text.length > MAX_MESSAGE_CHARS
        ? `${m.text.slice(0, MAX_MESSAGE_CHARS).trimEnd()} […]`
        : m.text,
  }))
  if (clipped.length === 0) return []
  const first = clipped[0]!
  let budget = MAX_THREAD_CHARS - first.text.length
  const rest: ClassificationMessage[] = []
  for (let i = clipped.length - 1; i >= 1; i--) {
    const m = clipped[i]!
    if (m.text.length > budget) break
    budget -= m.text.length
    rest.unshift(m)
  }
  return [first, ...rest]
}

/**
 * Structured-output grammar: no `minimum`/`maximum` on numbers (the API rejects them with a 400),
 * so the 0 to 1 range is stated in the description and enforced by ClassificationSchema.
 */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    caseType: { type: 'string', enum: [...CASE_TYPE_KEYS] },
    confidence: {
      type: 'number',
      description: 'Probability between 0 and 1 that caseType is right.',
    },
    rationale: { type: 'string' },
  },
  required: ['caseType', 'confidence', 'rationale'],
  additionalProperties: false,
} as const

/** Below the shared threshold the case is `unclear`, the same rule the live agent follows. */
export function applyThreshold(c: Classification): Classification {
  if (c.caseType !== 'unclear' && c.confidence < UNCLEAR_CONFIDENCE_THRESHOLD) {
    return { ...c, caseType: 'unclear' }
  }
  return c
}

// ---------------------------------------------------------------- clients

export function createAnthropicClassifier(opts: {
  apiKey: string
  model?: string
  /** One `model_calls` row per classification (IRDR-460); null records nothing. */
  usage?: UsageSink | null
}): HistoryClassifier {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 120_000, maxRetries: 2 })
  const model = opts.model || MODELS.classify
  const system = classificationSystemPrompt()
  const usage = opts.usage ?? null
  return {
    kind: 'anthropic',
    model,
    async classify(input) {
      const response = await trackModelCall(
        usage,
        { purpose: 'history_classification', model, ticketId: ticketIdOrNull(input.ticketId) },
        () =>
          client.messages.create({
            model,
            max_tokens: 1024,
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: classificationUserPrompt(input) }],
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: CLASSIFICATION_JSON_SCHEMA },
            },
          }),
      )
      if (response.stop_reason === 'refusal') {
        throw new Error(`model refused (${response.stop_details?.category ?? 'no category'})`)
      }
      if (response.stop_reason === 'max_tokens') throw new Error('model output was cut off')
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      const raw = JSON.parse(text) as { confidence?: unknown }
      if (typeof raw.confidence === 'number')
        raw.confidence = Math.min(1, Math.max(0, raw.confidence))
      const parsed = ClassificationSchema.safeParse(raw)
      if (!parsed.success) throw new Error(`model output did not validate: ${parsed.error.message}`)
      return applyThreshold(parsed.data)
    },
  }
}

/** Tests: a fixed answer, or a function of the input (throw to simulate a model failure). */
export function createFakeClassifier(
  answer:
    Classification | ((input: ClassificationInput) => Classification | Promise<Classification>) = {
    caseType: 'product_question',
    confidence: 0.9,
    rationale: 'fake',
  },
): HistoryClassifier & { readonly calls: ClassificationInput[] } {
  const calls: ClassificationInput[] = []
  return {
    kind: 'fake',
    model: 'fake',
    calls,
    async classify(input) {
      calls.push(input)
      return applyThreshold(typeof answer === 'function' ? await answer(input) : answer)
    },
  }
}

export function classifierFromConfig(
  config: Pick<MailConfig, 'anthropicApiKey'>,
  usage: UsageSink | null = null,
): HistoryClassifier | null {
  return config.anthropicApiKey
    ? createAnthropicClassifier({ apiKey: config.anthropicApiKey, usage })
    : null
}

// ---------------------------------------------------------------- the chunk

interface PendingTicket {
  id: string
  subject: string | null
  customer_email: string
  customer_name: string | null
  attempts: number
}

const PENDING_WHERE = `t.imported_at is not null and t.case_type is null and coalesce(c.attempts, 0) < $1`

export async function loadClassificationInput(
  db: Db,
  ticket: Pick<PendingTicket, 'id' | 'subject' | 'customer_email' | 'customer_name'>,
): Promise<ClassificationInput> {
  const rows = await db.query<{
    direction: 'in' | 'out'
    at: Date | null
    text: string | null
  }>(
    `select direction, coalesce(received_at, sent_at, created_at) as at,
       coalesce(nullif(text_stripped, ''), text_body, '') as text
     from public.messages where ticket_id = $1 order by created_at asc, id asc`,
    [ticket.id],
  )
  return {
    ticketId: ticket.id,
    subject: ticket.subject,
    customerEmail: ticket.customer_email,
    customerName: ticket.customer_name,
    messages: rows.map((r) => ({
      direction: r.direction,
      at: r.at ? r.at.toISOString().slice(0, 10) : null,
      text: (r.text ?? '').replace(/\s+\n/g, '\n').trim(),
    })),
  }
}

export interface ClassifyChunkResult {
  classified: number
  failed: number
  /** Tickets still waiting after this chunk (attempts left). */
  remaining: number
  done: boolean
}

export async function runClassifyChunk(
  ctx: MailContext,
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<ClassifyChunkResult> {
  const { db, classifier } = ctx
  if (!classifier)
    throw new Error('classify_imported: no classifier (ANTHROPIC_API_KEY is not set)')
  const limit = opts.limit ?? MAILBOX.backfill.classifyChunkLimit
  const deadline = Date.now() + (opts.budgetMs ?? MAILBOX.backfill.classifyChunkBudgetMs)
  const maxAttempts = MAILBOX.backfill.classifyMaxAttempts
  const pending = await db.query<PendingTicket>(
    `select t.id, t.subject, t.customer_email, t.customer_name, coalesce(c.attempts, 0)::int as attempts
     from public.tickets t left join public.ticket_classifications c on c.ticket_id = t.id
     where ${PENDING_WHERE}
     order by t.first_message_at asc nulls last, t.created_at asc
     limit $2`,
    [maxAttempts, limit],
  )
  const result: ClassifyChunkResult = { classified: 0, failed: 0, remaining: 0, done: false }
  for (const ticket of pending) {
    if (Date.now() > deadline) break
    const input = await loadClassificationInput(db, ticket)
    try {
      const c = await classifier.classify(input)
      await db.transaction(async (tx) => {
        await tx.query(
          `update public.tickets set case_type = $2, case_confidence = $3,
             risk_level = case when risk_level = 'none' then $4 else risk_level end
           where id = $1 and imported_at is not null`,
          [ticket.id, c.caseType, c.confidence, CASE_TYPES[c.caseType].defaultRisk],
        )
        await tx.query(
          `insert into public.ticket_classifications (ticket_id, attempts, model, case_type, confidence, rationale, last_error)
           values ($1, 1, $2, $3, $4, $5, null)
           on conflict (ticket_id) do update set attempts = ticket_classifications.attempts + 1,
             model = excluded.model, case_type = excluded.case_type, confidence = excluded.confidence,
             rationale = excluded.rationale, last_error = null`,
          [ticket.id, classifier.model, c.caseType, c.confidence, c.rationale],
        )
      })
      result.classified++
    } catch (e) {
      const message = errorMessage(e)
      ctx.log(`[mail] classify ${ticket.id} failed (attempt ${ticket.attempts + 1}): ${message}`)
      await db.query(
        `insert into public.ticket_classifications (ticket_id, attempts, model, last_error)
         values ($1, 1, $2, $3)
         on conflict (ticket_id) do update set attempts = ticket_classifications.attempts + 1,
           model = excluded.model, last_error = excluded.last_error`,
        [ticket.id, classifier.model, message],
      )
      result.failed++
    }
  }
  const left = await db.one<{ n: number }>(
    `select count(*)::int as n from public.tickets t
     left join public.ticket_classifications c on c.ticket_id = t.id where ${PENDING_WHERE}`,
    [maxAttempts],
  )
  result.remaining = left?.n ?? 0
  result.done = result.remaining === 0
  return result
}

/** Enqueues the first chunk when tickets wait, a model is configured and no chunk is pending. */
export async function scheduleImportedClassification(
  ctx: MailContext,
): Promise<{ started: boolean; reason: string | null }> {
  const { db } = ctx
  const queue = new JobQueue(db)
  const progress = await classifyProgress(db)
  if (progress.pending === 0) return { started: false, reason: 'nothing waits for a case' }
  if (!ctx.classifier) return { started: false, reason: 'ANTHROPIC_API_KEY is not set' }
  if (await queue.hasPendingOfType('classify_imported'))
    return { started: false, reason: 'a classification run is already pending' }
  await queue.enqueue('classify_imported', {}, { runAt: ctx.now() })
  return { started: true, reason: null }
}

export async function classifyProgress(
  db: Db,
  opts: { active?: boolean; classifier?: HistoryClassifier | null } = {},
): Promise<MailClassifyProgress> {
  const maxAttempts = MAILBOX.backfill.classifyMaxAttempts
  const row = await db.one<{
    imported: number
    classified: number
    pending: number
    failed: number
    last_error: string | null
  }>(
    `select
       count(*)::int as imported,
       count(*) filter (where t.case_type is not null)::int as classified,
       count(*) filter (where t.case_type is null and coalesce(c.attempts, 0) < $1)::int as pending,
       count(*) filter (where t.case_type is null and coalesce(c.attempts, 0) >= $1)::int as failed,
       (select c2.last_error from public.ticket_classifications c2
          where c2.last_error is not null order by c2.updated_at desc limit 1) as last_error
     from public.tickets t left join public.ticket_classifications c on c.ticket_id = t.id
     where t.imported_at is not null`,
    [maxAttempts],
  )
  const active = opts.active ?? (await new JobQueue(db).hasPendingOfType('classify_imported'))
  const pending = row?.pending ?? 0
  return {
    imported: row?.imported ?? 0,
    classified: row?.classified ?? 0,
    pending,
    failed: row?.failed ?? 0,
    active,
    blocked:
      pending > 0 && !active && opts.classifier === null ? 'ANTHROPIC_API_KEY is not set' : null,
    lastError: row?.last_error ?? null,
  }
}

export type { CaseType }
