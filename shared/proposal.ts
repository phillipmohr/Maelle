/**
 * The agent's output contract. Every proposal is validated with `ProposalSchema` before it is
 * written. The UI renders exactly this shape.
 */
import { z } from 'zod'
import { ACTION_PARAM_SCHEMAS, ACTION_TYPES, ACTIONS, ACTION_STAGES } from './actions'
import { CASE_TYPE_KEYS, RESEARCH_SOURCES, RISK_LEVELS } from './case-types'

export const CaseTypeSchema = z.enum(CASE_TYPE_KEYS)
export const ActionTypeSchema = z.enum(ACTION_TYPES)
export const RiskLevelSchema = z.enum(RISK_LEVELS)
export const ActionStageSchema = z.enum(ACTION_STAGES)

/** Unicode em dash and its lookalikes. Replies must never contain one. */
export const EM_DASH_RE = /[—―]/

export const SourceChipSchema = z.object({
  kind: z.enum([...RESEARCH_SOURCES, 'notion', 'ticket']),
  /** Chip text, e.g. "Stripe · sub_1PzT8c", "Knowledge base · Refund policy", "Email history · #4410". */
  label: z.string().min(1).max(120),
  /** Object id, table name, function name, ticket number, Notion page id, Linear identifier. */
  ref: z.string().max(200).optional(),
  /** Deep link (Stripe dashboard, Notion page, Linear issue, Maelle ticket). */
  url: z.url().optional(),
})
export type SourceChip = z.infer<typeof SourceChipSchema>

export const EvidenceRowSchema = z.object({
  timestamp: z.string().min(1).max(40),
  event: z.string().min(1).max(200),
  id: z.string().max(200).default(''),
  tone: z.enum(['default', 'bad', 'muted']).default('default'),
})
export type EvidenceRow = z.infer<typeof EvidenceRowSchema>

export const ResearchItemSchema = z.object({
  text: z.string().min(1).max(500),
  sources: z.array(SourceChipSchema).min(1),
  evidence: z.array(EvidenceRowSchema).max(50).default([]),
  logLines: z.array(z.string().max(500)).max(50).default([]),
})
export type ResearchItem = z.infer<typeof ResearchItemSchema>

export const AttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  /** Path in the `attachments` Storage bucket. */
  storagePath: z.string().min(1).max(500),
  contentType: z.string().max(100).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
})
export type Attachment = z.infer<typeof AttachmentSchema>

export const ReplyDraftSchema = z.object({
  /** Name of the Notion template the draft follows, or null when drafted from the protocol. */
  template: z.string().max(120).nullable().default(null),
  templateNotionPageId: z.string().max(64).nullable().default(null),
  to: z.email(),
  subject: z.string().min(1).max(300),
  /** Plain text. Paragraphs separated by blank lines. */
  body: z.string().min(1).max(10_000),
  attachments: z.array(AttachmentSchema).max(10).default([]),
})
export type ReplyDraft = z.infer<typeof ReplyDraftSchema>

export const KnowledgeRefSchema = z.object({
  kind: z.enum(['template', 'kb', 'example', 'protocol']),
  notionPageId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
})
export type KnowledgeRef = z.infer<typeof KnowledgeRefSchema>

/**
 * Hand-off (IRDR-477): the case is clear, but no template, rule or fact tells the agent how to
 * answer. No reply and no actions; Phillip takes over. Not `unclear` (that is an uncertain case).
 */
export const HandoffSchema = z.object({
  /** One sentence for Phillip: what the customer wants and which instruction or fact is missing. */
  reason: z.string().min(1).max(300),
})
export type Handoff = z.infer<typeof HandoffSchema>

export const CandidateCaseSchema = z.object({
  case: CaseTypeSchema,
  confidence: z.number().min(0).max(1),
})
export type CandidateCase = z.infer<typeof CandidateCaseSchema>

export const ProposedActionSchema = z
  .object({
    type: ActionTypeSchema,
    params: z.record(z.string(), z.unknown()).default({}),
    /** One line, "Because: …". */
    reason: z.string().min(1).max(300),
    stage: ActionStageSchema.default('now'),
    /** The reply depends on it; a failure holds the reply. */
    requiredForReply: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .superRefine((a, ctx) => {
    const result = ACTION_PARAM_SCHEMAS[a.type].safeParse(a.params)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['params', ...issue.path.map(String)],
          message: `${a.type}: ${issue.message}`,
        })
      }
    }
  })
export type ProposedAction = z.infer<typeof ProposedActionSchema>
export type ProposedActionInput = z.input<typeof ProposedActionSchema>

export const RiskSchema = z.object({
  level: RiskLevelSchema,
  reason: z.string().max(500).nullable().default(null),
  /** ISO date, e.g. a bank asking for documentation within 10 days. */
  dueDate: z.iso.date().nullable().default(null),
})
export type Risk = z.infer<typeof RiskSchema>

export const ProposalSchema = z
  .object({
    case: CaseTypeSchema,
    confidence: z.number().min(0).max(1),
    /** Filled when `case` is `unclear`: top 3 candidates for the user to pick from. */
    candidateCases: z.array(CandidateCaseSchema).max(3).default([]),
    risk: RiskSchema,
    /** True when the template requires confirmation and the thread has none yet. */
    customerConfirmationNeeded: z.boolean(),
    stage: z.union([z.literal(1), z.literal(2)]).default(1),
    /** The proposal line, e.g. "Cancel at period end, store the reason, send reply." */
    summaryLine: z.string().min(1).max(200),
    /** e.g. "3 actions · all reversible". Computed by code when omitted. */
    metaLine: z.string().max(120).nullable().default(null),
    research: z.array(ResearchItemSchema).max(12).default([]),
    researchWarnings: z.array(z.string().max(200)).default([]),
    policyWarnings: z.array(z.string().max(300)).default([]),
    conclusion: z.string().max(500).nullable().default(null),
    actions: z.array(ProposedActionSchema).max(11).default([]),
    /** Null only for `unclear` and hand-off proposals. */
    reply: ReplyDraftSchema.nullable(),
    knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
    noKnowledgeFound: z.boolean().default(false),
    /** Set when no instruction fits: no reply, no actions, Phillip takes over (IRDR-477). */
    handoff: HandoffSchema.nullable().default(null),
  })
  .superRefine((p, ctx) => {
    // Registry order, Send reply last.
    const order = p.actions.map((a) => ACTIONS[a.type].order)
    for (let i = 1; i < order.length; i++) {
      if (order[i]! < order[i - 1]!) {
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i],
          message: 'Actions must be in registry order; Send reply is always last.',
        })
        break
      }
    }
    // At most one Send reply, and only when a reply draft exists.
    const replies = p.actions.filter((a) => a.type === 'send_reply')
    if (replies.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Only one Send reply action is allowed.',
      })
    }
    if (replies.length === 1 && !p.reply) {
      ctx.addIssue({ code: 'custom', path: ['reply'], message: 'Send reply needs a reply draft.' })
    }
    // Unclear: candidates, no actions.
    if (p.case === 'unclear') {
      if (p.candidateCases.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidateCases'],
          message: 'Unclear proposals list candidate cases.',
        })
      }
      if (p.actions.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['actions'],
          message: 'Unclear proposals have no actions.',
        })
      }
      if (p.handoff) {
        ctx.addIssue({
          code: 'custom',
          path: ['handoff'],
          message:
            'A hand-off keeps the real case; unclear proposals list candidate cases instead.',
        })
      }
    } else if (p.handoff) {
      // Hand-off: Phillip answers and decides, so nothing is drafted or proposed.
      if (p.reply) {
        ctx.addIssue({
          code: 'custom',
          path: ['reply'],
          message: 'A hand-off has no reply draft (reply null).',
        })
      }
      if (p.actions.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['actions'],
          message: 'A hand-off has no actions.',
        })
      }
    } else if (!p.reply && p.actions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['reply'],
        message: 'A proposal needs a reply or at least one action.',
      })
    }
    // Never an em dash in customer-facing text.
    if (p.reply && (EM_DASH_RE.test(p.reply.body) || EM_DASH_RE.test(p.reply.subject))) {
      ctx.addIssue({
        code: 'custom',
        path: ['reply', 'body'],
        message: 'Replies must not contain an em dash.',
      })
    }
    // Stage 1 with confirmation pending: irreversible actions wait for the customer.
    if (p.customerConfirmationNeeded && p.stage === 1) {
      p.actions.forEach((a, i) => {
        if (ACTIONS[a.type].irreversible && a.stage !== 'after_confirmation') {
          ctx.addIssue({
            code: 'custom',
            path: ['actions', i, 'stage'],
            message:
              'Irreversible actions wait for the customer confirmation (stage after_confirmation).',
          })
        }
      })
    }
    // Safety is always safety.
    if (p.case === 'safety_removal' && p.risk.level !== 'safety') {
      ctx.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: 'Safety / removal requests carry risk level safety.',
      })
    }
  })

export type Proposal = z.infer<typeof ProposalSchema>
export type ProposalInput = z.input<typeof ProposalSchema>

/** Parse and validate a proposal. Throws a ZodError with readable paths on failure. */
export function parseProposal(input: unknown): Proposal {
  return ProposalSchema.parse(input)
}

export function safeParseProposal(input: unknown) {
  return ProposalSchema.safeParse(input)
}

/** "3 actions · all reversible", "Now: 1 action · Queued: 2 irreversible", "1 action · reply only". */
export function proposalMetaLine(
  p: Pick<Proposal, 'actions' | 'stage' | 'customerConfirmationNeeded'>,
): string {
  const enabled = p.actions.filter((a) => a.enabled)
  const now = enabled.filter((a) => a.stage === 'now')
  const queued = enabled.filter((a) => a.stage === 'after_confirmation')
  const irreversible = enabled.filter((a) => ACTIONS[a.type].irreversible)
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  if (queued.length > 0) {
    const qi = queued.filter((a) => ACTIONS[a.type].irreversible).length
    return `Now: ${plural(now.length, 'action')} · Queued: ${qi > 0 ? `${qi} irreversible` : plural(queued.length, 'action')}`
  }
  if (enabled.length === 1 && enabled[0]!.type === 'send_reply') return '1 action · reply only'
  if (irreversible.length === 0) return `${plural(enabled.length, 'action')} · all reversible`
  return `${plural(enabled.length, 'action')} · ${irreversible.length} irreversible`
}

/** Format the zod issues of a failed proposal so they can be fed back to the model. */
export function formatProposalIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}
