/**
 * Turns a `submit_proposal` tool input into a validated Proposal. Deterministic code owns the
 * decisions that must not depend on the model: the confirmation stage, the risk floor, the due
 * date, policy warnings, research warnings, knowledge refs, the recipient and the chargeback
 * attachment. Whatever remains invalid is fed back to the model as issues.
 */
import { z } from 'zod'
import { isActionType, sortByActionOrder } from '#shared/actions'
import type { MessageRow, TicketRow } from '#shared/api'
import { CASE_TYPES, isCaseType, type CaseType } from '#shared/case-types'
import {
  ProposalSchema,
  RiskSchema,
  formatProposalIssues,
  proposalMetaLine,
  type KnowledgeRef,
  type Proposal,
} from '#shared/proposal'
import type { AgentTrigger } from '#shared/services'
import type { AttachmentStore } from './attachments/store'
import { buildStripeTimeline, renderStripeTimelineSvg } from './attachments/stripe-timeline'
import type { CustomerFacts } from './context'
import type { Knowledge } from './knowledge/types'
import { applyRiskPolicy, policyWarnings, type PolicyContext } from './policy'
import { TranslationSchema, type Translation } from './tools/definitions'
import type { ConfirmationSignal, ResearchBundle } from './types'

export interface FinalizeContext {
  ticket: TicketRow
  messages: MessageRow[]
  trigger: AgentTrigger
  knowledge: Knowledge
  facts: CustomerFacts
  research: ResearchBundle
  researchWarnings: string[]
  confirmation: ConfirmationSignal
  caseOverride: CaseType | null
  attachments: AttachmentStore
  now: Date
}

export type FinalizeResult =
  | { ok: true; proposal: Proposal; translations: Translation[]; notes: string[] }
  | { ok: false; issues: string[] }

type Obj = Record<string, unknown>
const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))]

export function customerTexts(messages: MessageRow[]): {
  all: string
  latest: string
  receivedAt: string
} {
  const inbound = [...messages]
    .filter((m) => m.direction === 'in')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const text = (m: MessageRow) => `${m.subject ?? ''}\n${m.translation ?? m.textBody ?? ''}`
  const latest = inbound[inbound.length - 1]
  return {
    all: inbound.map(text).join('\n\n'),
    latest: latest ? text(latest) : '',
    receivedAt: latest?.receivedAt ?? latest?.createdAt ?? new Date(0).toISOString(),
  }
}

export function policyContextFor(ctx: FinalizeContext, caseType: CaseType): PolicyContext {
  const texts = customerTexts(ctx.messages)
  return {
    caseType,
    facts: ctx.facts,
    customerText: texts.all,
    latestCustomerText: texts.latest,
    receivedAt: texts.receivedAt,
    now: ctx.now,
    confirmation: ctx.confirmation,
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export async function finalizeSubmission(
  raw: unknown,
  ctx: FinalizeContext,
): Promise<FinalizeResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {
      ok: false,
      issues: ['submit_proposal input must be a JSON object with the proposal fields'],
    }
  const { translations: rawTranslations, ...rest } = raw as Obj
  const issues: string[] = []
  const notes: string[] = []

  // Translations: validated separately, stripped from the proposal.
  let translations: Translation[] = []
  const tr = z.array(TranslationSchema).safeParse(rawTranslations ?? [])
  if (!tr.success)
    issues.push(...tr.error.issues.map((i) => `translations.${i.path.join('.')}: ${i.message}`))
  else {
    translations = tr.data
    for (const t of translations)
      if (!ctx.messages.some((m) => m.id === t.messageId))
        issues.push(
          `translations: unknown messageId "${t.messageId}" (use the messageId values printed in the thread)`,
        )
  }

  const caseKey = rest.case
  if (ctx.caseOverride && caseKey !== ctx.caseOverride)
    issues.push(
      `case: the user chose "${ctx.caseOverride}" for this ticket (case_override run); the proposal must use exactly this case.`,
    )

  if (isCaseType(caseKey)) {
    const def = CASE_TYPES[caseKey]
    // Two-stage enforcement: code decides whether the customer still has to confirm.
    const needed = def.requiresConfirmation && ctx.confirmation !== 'confirmed'
    if (rest.customerConfirmationNeeded !== needed) {
      rest.customerConfirmationNeeded = needed
      notes.push(
        needed
          ? `customerConfirmationNeeded set to true by policy: "${def.label}" requires the customer's confirmation and the thread has no explicit confirmation yet, so irreversible actions must use stage "after_confirmation" and the proposal stays in stage 1.`
          : `customerConfirmationNeeded set to false by policy (${def.requiresConfirmation ? 'the customer confirmed in the thread' : 'this case needs no confirmation'}).`,
      )
    }
    if (needed && rest.stage !== 1) {
      rest.stage = 1
      notes.push('stage set to 1 by policy (confirmation pending).')
    }
    if (!def.requiresConfirmation && rest.stage === 2) {
      rest.stage = 1
      notes.push('stage set to 1 by policy (single-stage case).')
    }
  }

  // Recipient: always the ticket's customer (the bank for a chargeback).
  const reply = rest.reply as Obj | null | undefined
  if (reply && typeof reply === 'object') {
    if (
      typeof reply.to !== 'string' ||
      reply.to.toLowerCase() !== ctx.ticket.customerEmail.toLowerCase()
    ) {
      reply.to = ctx.ticket.customerEmail
      notes.push(`reply.to set to ${ctx.ticket.customerEmail}.`)
    }
  }
  if (Array.isArray(rest.actions)) {
    for (const a of rest.actions as Obj[]) {
      if (a && a.type === 'send_reply') {
        const params = (a.params as Obj | undefined) ?? {}
        if (
          typeof params.to !== 'string' ||
          params.to.toLowerCase() !== ctx.ticket.customerEmail.toLowerCase()
        )
          a.params = { ...params, to: ctx.ticket.customerEmail }
      }
    }
    if ((rest.actions as Obj[]).every((a) => a && isActionType(a.type)))
      rest.actions = sortByActionOrder(
        rest.actions as { type: Parameters<typeof sortByActionOrder>[0][number]['type'] }[],
      )
  }

  // Risk floor and due date.
  if (isCaseType(caseKey)) {
    const riskParsed = RiskSchema.safeParse(rest.risk ?? { level: 'none' })
    if (riskParsed.success) {
      const r = applyRiskPolicy(riskParsed.data, policyContextFor(ctx, caseKey))
      rest.risk = r.risk
      notes.push(...r.notes)
    }
  }

  // Knowledge refs: the template used is always listed; noKnowledgeFound follows the kb refs.
  const refs: KnowledgeRef[] = Array.isArray(rest.knowledgeRefs)
    ? (rest.knowledgeRefs as KnowledgeRef[]).filter((k) => k && typeof k === 'object')
    : []
  if (isCaseType(caseKey)) {
    const template = ctx.knowledge.templates.find((t) => t.caseType === caseKey)
    if (
      template &&
      !refs.some((k) => k.kind === 'template' && k.notionPageId === template.notionPageId)
    )
      refs.push({ kind: 'template', notionPageId: template.notionPageId, title: template.name })
    if (reply && typeof reply === 'object' && template) {
      if (!reply.templateNotionPageId) reply.templateNotionPageId = template.notionPageId
      if (!reply.template) reply.template = template.name
    }
  }
  rest.knowledgeRefs = refs
  rest.noKnowledgeFound = !refs.some((k) => k.kind === 'kb')

  // Research warnings: code knows which sources failed.
  const modelWarnings = Array.isArray(rest.researchWarnings)
    ? (rest.researchWarnings as unknown[]).map(String)
    : []
  rest.researchWarnings = unique([...ctx.researchWarnings, ...modelWarnings]).map((w) =>
    w.slice(0, 200),
  )
  if (!Array.isArray(rest.policyWarnings)) rest.policyWarnings = []

  if (issues.length) return { ok: false, issues: withNotes(issues, notes) }

  const parsed = ProposalSchema.safeParse(rest)
  if (!parsed.success)
    return { ok: false, issues: withNotes(formatProposalIssues(parsed.error), notes) }
  const proposal = parsed.data
  proposal.metaLine ??= proposalMetaLine(proposal)

  // Policy warnings in code.
  const pw = policyWarnings(proposal, policyContextFor(ctx, proposal.case))
  proposal.policyWarnings = unique([...proposal.policyWarnings, ...pw]).map((w) => w.slice(0, 300))

  // Chargeback evidence: the Stripe timeline as an attachment of the reply draft.
  if (proposal.case === 'chargeback' && proposal.reply && ctx.research.stripe.data) {
    const rows = buildStripeTimeline(ctx.research.stripe.data)
    if (rows.length > 0) {
      const customer = ctx.research.stripe.data.customer
      const svg = renderStripeTimelineSvg({
        title: `Stripe activity timeline · ${customer?.name ?? customer?.email ?? ctx.ticket.customerEmail}`,
        subtitle: `Customer ${customer?.id ?? 'unknown'} · InstaRadar ticket #${ctx.ticket.displayNumber} · ${customer?.email ?? ''}`,
        rows,
        generatedAt: ctx.now.toISOString(),
      })
      const name = `stripe-timeline-${slug(customer?.name ?? customer?.email ?? 'customer')}.svg`
      try {
        const stored = await ctx.attachments.put(
          `tickets/${ctx.ticket.id}/${name}`,
          svg,
          'image/svg+xml',
        )
        if (!proposal.reply.attachments.some((a) => a.name === name))
          proposal.reply.attachments.push({
            name,
            storagePath: stored.storagePath,
            contentType: stored.contentType,
            sizeBytes: stored.sizeBytes,
          })
        for (const a of proposal.actions)
          if (a.type === 'send_reply') a.params = { ...a.params, includeAttachments: true }
        notes.push(`Stripe timeline attached (${rows.length} events, ${name}).`)
      } catch (e) {
        proposal.researchWarnings = unique([
          ...proposal.researchWarnings,
          `Stripe timeline attachment could not be stored (${(e as Error).message})`,
        ])
      }
    }
  }

  return { ok: true, proposal, translations, notes }
}

function withNotes(issues: string[], notes: string[]): string[] {
  return notes.length
    ? [...issues, `Policy notes (applied by code before validation): ${notes.join(' ')}`]
    : issues
}
