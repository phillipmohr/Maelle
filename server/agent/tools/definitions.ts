/**
 * The tools the model sees: read-only research tools plus `submit_proposal`. Every research tool
 * is dispatched here to a read client; the dispatcher never gets a write client because none exists
 * in this module tree.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ProposalSchema } from '#shared/proposal'
import { INSTARADAR } from '#shared/config'
import type { PreviousTicketSummary, ProgressSource } from '../types'
import type { AgentTools } from './index'
import { SELECT_MAX_ROWS } from './instaradar'

export const SUBMIT_TOOL = 'submit_proposal'

export const TranslationSchema = z.object({
  /** `messages.id` of the customer message that was translated. */
  messageId: z.string().min(1),
  /** English translation of the customer's message, plain text. */
  translation: z.string().min(1).max(10_000),
})
export type Translation = z.infer<typeof TranslationSchema>

/** The proposal plus translations of non-English customer messages. Stripped before ProposalSchema runs. */
export const SubmitProposalInputSchema = z.object({
  ...ProposalSchema.shape,
  translations: z.array(TranslationSchema).default([]),
})

const DESCRIPTIONS: Record<string, string> = {
  case: 'One of the case keys. Use "unclear" when the confidence is below 0.6 and list candidateCases (top 3).',
  confidence: 'Your confidence in the case, 0 to 1.',
  candidateCases: 'Only for case "unclear": the top 3 candidate cases with their confidence.',
  risk: 'level none | high | safety, a one-sentence reason, and dueDate (ISO date) when the message states a deadline.',
  customerConfirmationNeeded:
    'True when the template requires confirmation and the thread has no explicit customer confirmation yet.',
  stage:
    '1 for the first reply of a two-stage case (or any single-stage case), 2 after the customer confirmed.',
  summaryLine:
    'The proposal in one line, e.g. "Cancel at period end, store the reason, send reply." Max 200 chars.',
  metaLine: 'Leave null; computed by code.',
  research:
    '3 to 5 plain findings. Each with text, sources (chips: kind stripe|supabase|vercel|kb|linear|email|notion|ticket, label like "Stripe · sub_1PzT8c", optional ref and url), optional evidence rows (timestamp, event, id, tone) and logLines.',
  researchWarnings:
    'Sources that failed or were missing, e.g. "Vercel logs unavailable". Code adds the ones it knows.',
  policyWarnings: 'Leave empty; code adds policy warnings.',
  conclusion: 'One sentence for complex cases (chargebacks, billing disputes), else null.',
  actions:
    'Actions from the registry in registry order, Send reply last. Each: type, params (exactly the schema of that action), reason ("Because: ..."), stage now|after_confirmation, requiredForReply, enabled.',
  reply:
    'The reply draft: template (Notion template name or null), templateNotionPageId, to, subject, body (plain text, paragraphs separated by blank lines, no em dash), attachments []. Null only for "unclear" and a hand-off.',
  knowledgeRefs:
    'Every template and knowledge base entry you used: kind template|kb|example|protocol, notionPageId, title.',
  noKnowledgeFound:
    'True when no knowledge base entry fits the question. Leave false while the prompt has no knowledge base section.',
  handoff:
    'Null, unless the case is clear but no template, rule or fact tells you how to answer: then { reason } (one sentence for Phillip), reply null and actions [].',
  translations:
    'For every customer message that is not in English: its messageId and an English translation.',
}

export function submitProposalInputSchema(): Anthropic.Tool.InputSchema {
  const js = z.toJSONSchema(SubmitProposalInputSchema, {
    io: 'input',
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as Record<string, unknown>
  delete js.$schema
  const props = js.properties as Record<string, Record<string, unknown>> | undefined
  if (props)
    for (const [k, d] of Object.entries(DESCRIPTIONS)) if (props[k]) props[k]!.description = d
  return js as unknown as Anthropic.Tool.InputSchema
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Anthropic.Tool.InputSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

export function researchToolDefinitions(): Anthropic.Tool[] {
  const t = INSTARADAR.db
  const tableDoc = [
    `${t.schema}.${t.profiles}(id = the auth user id, email, created_at, stripe_customer_id, first_authenticated_at, referral_code)`,
    `${t.schema}.${t.subscriptions}(user_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, cancel_at_period_end, canceled_at, paused_at, created_at)`,
    `${t.schema}.${t.trackedProfiles}(tracked_profile_id, user_id, ${t.trackedHandleColumn}, full_name, is_private, follower_count, is_active, last_scanned_at, next_scan_at, created_at)`,
    `${t.schema}.${t.scanHistory}(tracked_profile_id, status, error_message, error_code, is_partial, scanned_at, created_at)`,
    `${t.schema}.scan_queue(tracked_profile_id, status, scheduled_at, started_at, completed_at, retry_count, error_message, error_code)`,
    `${t.schema}.${t.notificationLog}(user_id, tracked_profile_id, channel, event_type, status, sent_at, failed_at, error_message, created_at)`,
    `${t.schema}.activity_events(tracked_profile_id, event_type, event_data, detected_at)`,
    `${t.schema}.referrals(referrer_user_id, referee_user_id, code, status, created_at)`,
    `auth.audit_log_entries(payload->>'actor_id', payload->>'action', created_at)`,
  ].join('; ')
  return [
    {
      name: 'stripe_events',
      description:
        'Stripe events for a customer (subscription created/updated/deleted, invoices paid/failed, charges, refunds, disputes) as a timeline. Use for chargebacks and billing disputes when the research bundle is not detailed enough.',
      input_schema: obj(
        {
          customerId: { type: 'string', description: 'Stripe customer id (cus_...)' },
          days: {
            type: 'integer',
            minimum: 1,
            maximum: 730,
            description: 'Look-back window, default 180',
          },
        },
        ['customerId'],
      ),
    },
    {
      name: 'stripe_search_customers',
      description:
        'Search Stripe customers by name or email fragment. Use when the ticket is not from the account holder (a bank writing about its member) and the research bundle found no customer.',
      input_schema: obj(
        { query: { type: 'string', description: 'Name or email, e.g. "Rachel Kim"' } },
        ['query'],
      ),
    },
    {
      name: 'stripe_retrieve',
      description:
        'Retrieve one Stripe object by id (cus_, sub_, in_, ch_, pi_, re_, dp_). Read only. Use when you need a field the research bundle does not contain.',
      input_schema: obj({ id: { type: 'string' } }, ['id']),
    },
    {
      name: 'instaradar_select',
      description: `Run ONE read-only SELECT on the InstaRadar database for ad-hoc research (${SELECT_MAX_ROWS} rows max, statement timeout, no writes possible). Known tables (assumed names): ${tableDoc}. Always filter by the user id or handle you were given.`,
      input_schema: obj(
        {
          sql: { type: 'string', description: 'A single SELECT statement. No semicolons.' },
          purpose: { type: 'string', description: 'What you want to learn (one sentence).' },
        },
        ['sql', 'purpose'],
      ),
    },
    {
      name: 'instaradar_profile',
      description:
        'Look up an Instagram handle on InstaRadar: how many users track it and whether it is already blocked. Use for safety / removal requests.',
      input_schema: obj({ handle: { type: 'string' } }, ['handle']),
    },
    {
      name: 'vercel_logs',
      description:
        'Search the InstaRadar runtime logs (Vercel). Filter by text, user id or profile handle; returns matching lines with timestamps and the function name. Use for bug reports, outages and data accuracy questions.',
      input_schema: obj({
        text: { type: 'string', description: 'Substring to search for' },
        userId: { type: 'string' },
        handle: { type: 'string', description: 'Instagram handle without @' },
        sinceDays: { type: 'integer', minimum: 1, maximum: 90, description: 'Default 14' },
        level: {
          type: 'string',
          enum: ['error', 'warning', 'all'],
          description: 'Default warning (errors + warnings)',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 60' },
      }),
    },
    {
      name: 'linear_search',
      description:
        'Search team InstaRadar in Linear for an existing issue (bug or feature) so a duplicate gets linked instead of created. Returns identifier, title, state, labels, url.',
      input_schema: obj(
        {
          query: { type: 'string', description: 'A few words describing the bug or feature' },
          includeClosed: { type: 'boolean', description: 'Also return completed/cancelled issues' },
        },
        ['query'],
      ),
    },
    {
      name: 'notion_page',
      description:
        'Fetch the body text of a Notion page: a template (for the full reply text and notes) or a knowledge base entry. Pass the page id from the knowledge section.',
      input_schema: obj({ pageId: { type: 'string' } }, ['pageId']),
    },
    {
      name: 'email_history',
      description:
        "Previous tickets and messages of the same customer from Maelle's database, with the full message texts.",
      input_schema: obj({}),
    },
  ]
}

export function submitProposalTool(): Anthropic.Tool {
  return {
    name: SUBMIT_TOOL,
    description:
      'Submit the complete, final proposal for this ticket: case, risk, research findings with sources, actions from the registry, reply draft, knowledge references and translations. Call it exactly once when your research is done. If the input is rejected you receive the validation issues; fix them and call it again with the full proposal.',
    input_schema: submitProposalInputSchema(),
  }
}

export function allToolDefinitions(): Anthropic.Tool[] {
  return [...researchToolDefinitions(), submitProposalTool()]
}

// ---------------------------------------------------------------- dispatcher

export interface ToolContext {
  tools: AgentTools
  now: Date
  emailHistory: () => Promise<PreviousTicketSummary[]>
}

export interface ToolOutcome {
  source: ProgressSource | null
  isError: boolean
  content: string
}

export const TOOL_SOURCE: Record<string, ProgressSource> = {
  stripe_events: 'stripe',
  stripe_search_customers: 'stripe',
  stripe_retrieve: 'stripe',
  instaradar_select: 'supabase',
  instaradar_profile: 'supabase',
  vercel_logs: 'vercel',
  linear_search: 'linear',
  notion_page: 'kb',
  email_history: 'email',
}

/** A tool result is read by every later turn, so it stays small (about 3K tokens). */
export const MAX_RESULT_CHARS = 12_000

export function compactJson(value: unknown, max = MAX_RESULT_CHARS): string {
  const s = JSON.stringify(value, (_k, v) => (v === undefined ? null : v))
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n… truncated (${s.length - max} more characters). Narrow the query.`
}

const Inputs = {
  stripe_events: z.object({
    customerId: z.string().min(1),
    days: z.number().int().min(1).max(730).optional(),
  }),
  stripe_search_customers: z.object({ query: z.string().min(1) }),
  stripe_retrieve: z.object({ id: z.string().min(1) }),
  instaradar_select: z.object({ sql: z.string().min(1), purpose: z.string().optional() }),
  instaradar_profile: z.object({ handle: z.string().min(1) }),
  vercel_logs: z.object({
    text: z.string().optional(),
    userId: z.string().optional(),
    handle: z.string().optional(),
    sinceDays: z.number().int().min(1).max(90).optional(),
    level: z.enum(['error', 'warning', 'all']).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  linear_search: z.object({ query: z.string().min(1), includeClosed: z.boolean().optional() }),
  notion_page: z.object({ pageId: z.string().min(1) }),
  email_history: z.object({}).loose(),
}

export async function executeResearchTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const source = TOOL_SOURCE[name] ?? null
  const schema = (Inputs as Record<string, z.ZodType>)[name]
  if (!schema) return { source, isError: true, content: `Unknown tool: ${name}` }
  const parsed = schema.safeParse(rawInput ?? {})
  if (!parsed.success)
    return {
      source,
      isError: true,
      content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    }
  const input = parsed.data as Record<string, unknown>
  try {
    switch (name) {
      case 'stripe_events': {
        const events = await ctx.tools.stripe.listEvents(
          input.customerId as string,
          (input.days as number | undefined) ?? 180,
        )
        return { source, isError: false, content: compactJson({ count: events.length, events }) }
      }
      case 'stripe_search_customers': {
        const customers = await ctx.tools.stripe.searchCustomers(input.query as string)
        return {
          source,
          isError: false,
          content: compactJson({ count: customers.length, customers }),
        }
      }
      case 'stripe_retrieve': {
        const object = await ctx.tools.stripe.retrieve(input.id as string)
        return { source, isError: false, content: compactJson(object) }
      }
      case 'instaradar_select': {
        const result = await ctx.tools.instaradar.select(input.sql as string)
        return { source, isError: false, content: compactJson(result) }
      }
      case 'instaradar_profile': {
        const result = await ctx.tools.instaradar.lookupProfile(input.handle as string)
        return {
          source,
          isError: false,
          content: compactJson(
            result ?? {
              handle: input.handle,
              trackedByUsers: 0,
              blocked: false,
              note: 'not found on InstaRadar',
            },
          ),
        }
      }
      case 'vercel_logs': {
        const days = (input.sinceDays as number | undefined) ?? 14
        const lines = await ctx.tools.vercel.search({
          since: new Date(ctx.now.getTime() - days * 86_400_000).toISOString(),
          until: ctx.now.toISOString(),
          text: input.text as string | undefined,
          userId: input.userId as string | undefined,
          handle: input.handle as string | undefined,
          level: (input.level as 'error' | 'warning' | 'all' | undefined) ?? 'warning',
          limit: (input.limit as number | undefined) ?? 60,
        })
        return { source, isError: false, content: compactJson({ count: lines.length, lines }) }
      }
      case 'linear_search': {
        const issues = await ctx.tools.linear.searchIssues(input.query as string, {
          includeClosed: Boolean(input.includeClosed),
        })
        return { source, isError: false, content: compactJson({ count: issues.length, issues }) }
      }
      case 'notion_page': {
        const text = await ctx.tools.notion.getPageText(input.pageId as string)
        return { source, isError: false, content: text || '(empty page)' }
      }
      case 'email_history': {
        const tickets = await ctx.emailHistory()
        return { source, isError: false, content: compactJson({ count: tickets.length, tickets }) }
      }
      default:
        return { source, isError: true, content: `Unknown tool: ${name}` }
    }
  } catch (e) {
    return { source, isError: true, content: `${name} failed: ${(e as Error).message}` }
  }
}
