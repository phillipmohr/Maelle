/**
 * Prompt construction. The system prompt is stable per knowledge snapshot (so it caches across
 * runs); everything about the ticket goes into the user message.
 */
import { ACTION_LIST, ACTION_PARAM_SCHEMAS, type ActionType } from '#shared/actions'
import type { MessageRow, ProposalRow, TicketRow } from '#shared/api'
import {
  CASE_TYPES,
  TEMPLATE_CASE_TYPES,
  UNCLEAR_CONFIDENCE_THRESHOLD,
  type CaseType,
} from '#shared/case-types'
import type { AgentTrigger } from '#shared/services'
import { z } from 'zod'
import type { CustomerFacts } from './context'
import type { Knowledge } from './knowledge/types'
import type { ConfirmationSignal, LinearIssueSummary, ResearchBundle } from './types'

const PARAM_NOTES: Record<ActionType, string> = {
  cancel_at_period_end: 'stripeSubscriptionId (required), accessUntil (ISO date, informational)',
  cancel_immediately:
    'stripeSubscriptionId (required), profilesAffected (number of tracked profiles that will be deleted)',
  refund_latest_payment:
    'stripePaymentIntentId or stripeChargeId (one required, the LATEST successful payment), amountCents (required), currency, paymentAmountCents, paymentDate (ISO date), cardLabel ("Visa ··2291"), reason requested_by_customer|duplicate|fraudulent',
  delete_account: 'instaradarUserId (required), email (required)',
  stop_failed_payment_retries:
    'stripeCustomerId (required), stripeSubscriptionId, stripeInvoiceIds []',
  create_coupon:
    'kind percent|amount (required), percentOff or amountOffCents, currency, duration once|repeating|forever, durationInMonths, applyTo subscription|promotion_code, stripeCustomerId, stripeSubscriptionId, name',
  create_linear_ticket:
    'title (required, 3-200 chars), description (required), label Bug|Feature (required), existingIssueIdentifier ("INS-198": link instead of creating a duplicate), customerEmail (required)',
  store_release_notification_email:
    'email (required), linearIssueIdentifier (when the issue exists) OR fromActionPosition (the position of the create_linear_ticket action in this proposal when the issue is created by it)',
  store_cancellation_reason:
    'comment (required, verbatim reason or "Not stated"), feedback customer_service|low_quality|missing_features|other|switched_service|too_complex|too_expensive|unused, stripeCustomerId, stripeSubscriptionId',
  remove_from_tracking: 'instagramHandle (required, without @), reason (required)',
  send_reply: 'to (required, the customer email), cc [], includeAttachments (default true)',
}

function actionCatalogue(): string {
  return ACTION_LIST.map((a) => {
    const shape = z.toJSONSchema(ACTION_PARAM_SCHEMAS[a.key], {
      io: 'input',
      unrepresentable: 'any',
    }) as {
      required?: string[]
    }
    const required = shape.required?.length ? ` Required: ${shape.required.join(', ')}.` : ''
    return `- \`${a.key}\` (${a.label}, ${a.irreversible ? 'IRREVERSIBLE' : 'reversible'}, writes to ${a.target}): ${a.description} Params: ${PARAM_NOTES[a.key]}.${required}`
  }).join('\n')
}

function templateCatalogue(knowledge: Knowledge): string {
  const byCase = new Map(knowledge.templates.filter((t) => t.caseType).map((t) => [t.caseType!, t]))
  const lines: string[] = []
  for (const key of TEMPLATE_CASE_TYPES) {
    const def = CASE_TYPES[key]
    const t = byCase.get(key)
    lines.push(
      `### \`${key}\` · ${def.label}`,
      `Trigger: ${t?.trigger ?? def.trigger}`,
      `Template actions: ${(t?.actions ?? []).join(', ') || '(none)'} → registry: ${def.defaultActions.join(', ') || '(none)'}`,
      `Requires customer confirmation: ${(t?.requiresConfirmation ?? def.requiresConfirmation) ? 'yes (two-stage)' : 'no'} · default risk: ${def.defaultRisk} · research: ${def.research.join(', ') || 'none'}`,
      `Notion page id: ${t?.notionPageId ?? def.notionPageId ?? 'n/a'}`,
      t?.reply
        ? `Reply template:\n"""\n${t.reply}\n"""`
        : 'Reply template: (none in Notion, draft from the protocol)',
      '',
    )
  }
  const extra = knowledge.templates.filter((t) => !t.caseType)
  if (extra.length)
    lines.push(
      `Templates in Notion without a case key yet (use the closest case): ${extra.map((t) => t.name).join('; ')}`,
      '',
    )
  lines.push(
    `### \`release_notification\` · ${CASE_TYPES.release_notification.label}`,
    `Trigger: ${CASE_TYPES.release_notification.trigger} Actions: send_reply only. Draft from the protocol: warm, concrete, name the fix or feature, thank them for the report or idea. (No Notion template yet.)`,
    '',
    `### \`unclear\``,
    `Use when your confidence in every case is below ${UNCLEAR_CONFIDENCE_THRESHOLD}. candidateCases: top 3 with confidence. actions: []. reply: null. The user picks the case in the UI.`,
  )
  return lines.join('\n')
}

function knowledgeBaseSection(knowledge: Knowledge): string {
  if (knowledge.knowledgeBase.length === 0)
    return 'The knowledge base has no active entries yet. Set noKnowledgeFound to true and answer from the templates and the protocol. Do not invent product facts: when you are not sure how a feature works, ask the customer for details instead of guessing.'
  return knowledge.knowledgeBase
    .map(
      (e) =>
        `- **${e.name}** (page ${e.notionPageId}${e.category ? `, ${e.category}` : ''}${e.type ? `, ${e.type}` : ''})\n  Customer phrasing: ${e.customerPhrasing ?? '-'}\n  Short answer: ${e.shortAnswer ?? '-'}${e.lastVerified ? `\n  Last verified: ${e.lastVerified}` : ''}${e.linearTicket ? `\n  Linear: ${e.linearTicket}` : ''}`,
    )
    .join('\n')
}

function examplesSection(knowledge: Knowledge): string {
  if (knowledge.examples.length === 0) return '(none)'
  return knowledge.examples
    .map(
      (e) =>
        `- ${e.name} [${e.category ?? 'uncategorised'}] (page ${e.notionPageId})\n  Customer: "${e.customerMessage}"${e.response ? `\n  Response: """${e.response}"""` : ''}`,
    )
    .join('\n')
}

export function buildSystemPrompt(knowledge: Knowledge, opts: { supportMailbox: string }): string {
  return `# AnastasAI

You are AnastasAI, the research and drafting agent behind Anastasia, the customer support persona of InstaRadar (an app that tracks public Instagram profiles: followers, following, posts, stories). Every email to ${opts.supportMailbox} becomes a ticket. For each ticket you research read-only and prepare ONE decision for Phillip, the founder: the case, 3 to 5 research findings with sources, the actions to run (from a fixed registry) and the reply draft. You execute nothing. Phillip approves with one key, then deterministic code runs the actions. Everything you submit is validated by code against the schema and the rules below; a human reads it before anything happens.

## How a run works

1. The user message contains the ticket, the full email thread, a research bundle that code already fetched from Stripe, the InstaRadar database, the Vercel logs, Linear and the email history, plus derived customer facts and hints. Trust the bundle: it is the ground truth about this customer. Never invent ids, amounts, dates or profiles.
2. Decide first whether any research is needed; usually it is not. Routine cases go straight to \`submit_proposal\` without a single tool call: cancellations, cancellation reason asks, product and billing questions the facts, the templates and the knowledge base already answer, follow-ups, release notices, unsatisfied customers, feature requests. Call research tools only for: chargebacks and bank disputes (the exact Stripe event timeline), bug reports, outages and data accuracy questions (a log search, a Linear search), a source the bundle marks \`failed\` or \`skipped\` that this case needs, or one specific id, amount or page text that an action or the reply needs. Make every needed call in one turn (they run in parallel), then submit; never research one thing after another. Tools are read-only. If a tool fails, note it in researchWarnings and continue; a missing source never blocks the proposal.
3. Finish with exactly one \`submit_proposal\` call containing the complete proposal. If the input is rejected you get the issues back; fix them and call \`submit_proposal\` again with the whole proposal. Do not answer in plain text; the proposal is the only output that counts.

## Cases (the Notion Templates DB is the source of truth)

Classify the ticket into exactly one case. \`confidence\` is your honest probability. Below ${UNCLEAR_CONFIDENCE_THRESHOLD} use \`unclear\`.

${templateCatalogue(knowledge)}

## Actions (the registry; these 11 are the only actions that exist)

${actionCatalogue()}

Action rules:
- Only registry actions, in registry order (the order above), \`send_reply\` always last and at most once. Every action carries \`params\` exactly as specified and a one-line \`reason\` that starts with "Because: ".
- Use ids from the research bundle (Stripe subscription/payment ids, InstaRadar user id, Linear identifiers). If an id is not in the bundle and no tool returns it, leave optional params out and mention the gap in the research.
- \`requiredForReply: true\` when the reply depends on the action: a reply that promises a release notice needs \`store_release_notification_email\`; a reply that says "I've refunded" needs the refund; "I've cancelled" needs the cancellation. A failure of a required action then holds the reply.
- Two-stage cases (templates with "Requires confirmation": refunds, deletions): when the thread has no explicit confirmation from the customer yet, stage 1 = \`send_reply\` now and the irreversible actions with \`stage: "after_confirmation"\`, \`customerConfirmationNeeded: true\`. When this run was triggered by a customer reply that confirms ("Yes, refund"), propose stage 2: the queued actions with \`stage: "now"\` plus a short confirmation reply, \`customerConfirmationNeeded: false\`. When the customer changed their mind, propose that instead (no irreversible action, a kind reply).
- A cancellation request without the word refund means cancel at period end, never immediately. A refund means immediate cancellation and loss of data, so it always needs the confirmation stage. Only the latest payment is refundable. A second refund needs a reason. Account deletion only after cancellation and explicit confirmation.
- Bug reports and feature requests: search Linear first. When an open issue exists, propose \`create_linear_ticket\` with \`existingIssueIdentifier\` so it gets linked, not duplicated, and \`store_release_notification_email\` with \`linearIssueIdentifier\`. When no issue exists, propose \`create_linear_ticket\` (new) and \`store_release_notification_email\` with \`fromActionPosition\` pointing at it.
- Safety / removal requests: \`remove_from_tracking\` with the handle from the message, risk level safety, no research delay, no questions back.
- Chargebacks / bank disputes: reply only (no refund unless clearly warranted), factual, never submissive, with the Stripe timeline; code attaches the timeline image. Extract the bank's deadline as risk.dueDate.

## Research findings

3 to 5 plain-language findings a founder can read in ten seconds, each with source chips: kind and label such as "Stripe · sub_1PzT8c", "Supabase · tracked_profiles", "Vercel · scan-worker", "Email history · #4410", "Knowledge base · Follower count fluctuation", "Linear · INS-198". Add evidence rows (timestamp, event, id, tone bad for disputed or failed events) for timelines and logLines for log evidence. Add a one-sentence \`conclusion\` for complex cases. Report anything relevant you could not verify as a researchWarning.

## Risk

- \`safety\` for every Safety / removal request (always on top).
- \`high\` for chargebacks and bank disputes, legal threats, open disputes, and long-term customers (tag "Long-term") with an issue.
- Otherwise \`none\`. \`dueDate\` (ISO date) when a deadline is stated, e.g. a bank asking for documentation within 10 days.

## Reply draft

Follow the protocol below (Persona & Tone, Writing Principles, Rules) and the case template, filled with the concrete facts: amounts, dates, plan, profiles, names. Always English. New conversations start with "Hi, thanks for reaching out!" (or the template's own opening); replies inside a thread do not repeat the greeting. Never an em dash (the character —); use a comma, a colon or a new sentence. Do not add a closing line or a signature: Maelle appends Anastasia's signature (name, Customer Care · InstaRadar, contact details) when the mail is sent, so the body ends with its last sentence. Keep it to two to four short paragraphs. Subject: "Re: <the customer's subject>". The reply must not promise anything that is not in the actions (no "I've refunded" without a refund action, no "I'll let you know when it's live" without the release notification action). In stage 1 of a two-stage case, describe what happens (immediate cancellation, data deleted) and ask for a plain confirmation.

## Translations

When a customer message is not in English, provide its English translation in \`translations\` (messageId from the thread) and still reply in English.

## Knowledge references

List every template and knowledge base entry you used in \`knowledgeRefs\` (kind, notionPageId, title). Set \`noKnowledgeFound\` when no knowledge base entry fits the customer's question.

## Trigger-specific behaviour

- \`new_ticket\`: classify and draft as described.
- \`customer_reply\`: read the latest customer message in the context of what we sent. Detect confirmation, a change of mind, new information, or a new question. For two-stage cases propose stage 2 on a clear yes.
- \`case_override\`: the user picked the case; the hint names it. Use exactly that case and draft accordingly.
- \`rerun\`: same as a new run; take the previous proposal as a hint of what needs to be better, not as truth.
- \`follow_up\`: the ticket waited on the customer too long. Propose a short, friendly follow-up reply, or, when a follow-up already went out, a closing note (send_reply) that leaves the door open.
- \`release_notification\`: the Linear issue the customer waited for is done. Draft the "it's live" email from the issue and the customer's original thread: what they reported or asked for, what shipped, how to use it. Actions: send_reply only.

## Protocol (Notion, Customer Support page)

${knowledge.protocol}

## Examples (Notion Examples DB)

${examplesSection(knowledge)}

## Knowledge base (Notion, Status = Active, App = InstaRadar)

${knowledgeBaseSection(knowledge)}
`
}

// ---------------------------------------------------------------- user message

export interface UserMessageInput {
  ticket: TicketRow
  messages: MessageRow[]
  trigger: AgentTrigger
  research: ResearchBundle
  facts: CustomerFacts
  confirmation: ConfirmationSignal
  knowledgeWarnings: string[]
  researchWarnings: string[]
  previousProposal: ProposalRow | null
  caseOverride: CaseType | null
  release: {
    issue: LinearIssueSummary | null
    identifier: string
    originalThread: MessageRow[]
  } | null
  followUp: { waitingSince: string | null; daysWaiting: number | null } | null
  now: Date
}

const excerpt = (s: string | null | undefined, max: number) =>
  !s ? '' : s.length > max ? `${s.slice(0, max)}… [truncated ${s.length - max} chars]` : s

function threadSection(messages: MessageRow[]): string {
  if (messages.length === 0) return '(no messages)'
  return messages
    .map((m, i) => {
      const who =
        m.direction === 'in'
          ? `CUSTOMER (${m.fromName ?? m.fromEmail}, ${m.fromEmail})`
          : `US (${m.fromName ?? 'Anastasia'}${m.sentBy ? `, sent by ${m.sentBy}` : ''})`
      const at = m.receivedAt ?? m.sentAt ?? m.createdAt
      const attachments = m.attachments?.length
        ? `\nAttachments: ${m.attachments.map((a) => a.name).join(', ')}`
        : ''
      const translation = m.translation
        ? `\nStored English translation: ${excerpt(m.translation, 4000)}`
        : ''
      return `--- Message ${i + 1} · ${who} · ${at} · messageId ${m.id}\nSubject: ${m.subject ?? ''}\n${excerpt(m.textBody, 6000)}${translation}${attachments}`
    })
    .join('\n\n')
}

function compact(value: unknown, max = 30_000): string {
  const s = JSON.stringify(value, (_k, v) => (v === undefined ? null : v), 0)
  return s.length > max ? `${s.slice(0, max)}… [truncated]` : s
}

function researchSection(r: ResearchBundle): string {
  const stripe = r.stripe.data
  const ir = r.supabase.data
  const view = {
    stripe: {
      status: r.stripe.status,
      warning: r.stripe.warning,
      customer: stripe?.customer ?? null,
      otherCustomersWithSameEmail: stripe?.otherCustomers ?? [],
      subscriptions: stripe?.subscriptions ?? [],
      invoices: stripe?.invoices.slice(0, 15) ?? [],
      charges: stripe?.charges.slice(0, 15) ?? [],
      refunds: stripe?.refunds ?? [],
      disputes: stripe?.disputes ?? [],
      events: stripe?.events.slice(-25) ?? [],
    },
    instaradarDatabase: {
      status: r.supabase.status,
      warning: r.supabase.warning,
      user: ir?.user ?? null,
      trackedProfiles: ir?.trackedProfiles ?? [],
      signIns: { count: ir?.signIns.length ?? 0, latest: ir?.signIns.slice(0, 5) ?? [] },
      scans: {
        count: ir?.scans.length ?? 0,
        byStatus: countBy(ir?.scans ?? [], (s) => s.status ?? 'unknown'),
        latestErrors: (ir?.scans ?? []).filter((s) => s.error).slice(0, 10),
      },
      alerts: {
        count: ir?.alerts.length ?? 0,
        byType: countBy(
          ir?.alerts ?? [],
          (a) => `${a.type ?? 'unknown'}${a.handle ? ` @${a.handle}` : ''}`,
        ),
        latest: ir?.alerts.slice(0, 10) ?? [],
      },
      profilesMentionedInThread: ir?.mentionedProfiles ?? [],
    },
    vercelLogs: {
      status: r.vercel.status,
      warning: r.vercel.warning,
      matchingLines: r.vercel.data?.length ?? 0,
      lines: r.vercel.data?.slice(0, 30) ?? [],
    },
    linear: {
      status: r.linear.status,
      warning: r.linear.warning,
      candidateIssues: r.linear.data ?? [],
    },
    emailHistory: {
      status: r.email.status,
      warning: r.email.warning,
      previousTickets: r.email.data ?? [],
    },
  }
  return compact(view)
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1
  return out
}

function factsSection(f: CustomerFacts, now: Date): string {
  const view = {
    stripeCustomerId: f.stripeCustomerId,
    instaradarUserId: f.instaradarUserId,
    plan: f.plan,
    subscriptionStatus: f.subscriptionStatus,
    activeSubscriptionId: f.activeSubscription?.id ?? null,
    renewalDate: f.renewalDate,
    accessUntil: f.accessUntil,
    cancellationDate: f.cancellationDate,
    customerSince: f.customerSince,
    customerDays: f.customerDays,
    card: f.cardLabel,
    latestPayment: f.latestPayment,
    daysSinceLatestPayment: f.daysSinceLatestPayment,
    refundCount: f.refundCount,
    openDisputes: f.openDisputes.length,
    failedPayments: f.failedPayments,
    catchUpPayments: f.catchUpPayments,
    subscriptionsCount: f.subscriptionsCount,
    resubscribed: f.resubscribed,
    trackedProfiles: f.trackedProfiles.map((p) => `@${p.handle}`),
    signInsLast120Days: f.signIns,
    lastSignInAt: f.lastSignInAt,
    logErrors: f.logErrors,
    previousTickets: f.previousTickets,
    tags: f.tags,
    today: now.toISOString().slice(0, 10),
  }
  return compact(view)
}

export function buildUserMessage(input: UserMessageInput): string {
  const { ticket, messages, trigger, facts, confirmation, now } = input
  const inbound = messages.filter((m) => m.direction === 'in')
  const latest = inbound[inbound.length - 1]
  const hints: string[] = []
  hints.push(`Today is ${now.toISOString().slice(0, 10)}.`)
  hints.push(
    messages.some((m) => m.direction === 'out')
      ? 'This is a continuing thread: we have written to the customer before, so do not repeat the opening greeting.'
      : 'This is a new conversation: open with "Hi, thanks for reaching out!" (or the template\'s opening).',
  )
  if (confirmation === 'confirmed')
    hints.push(
      'Confirmation detected by code: the latest customer message reads as an explicit YES to what we asked. A two-stage case may move to stage 2.',
    )
  else if (confirmation === 'declined')
    hints.push(
      'Change of mind detected by code: the latest customer message reads as a NO / not anymore. Do not propose the irreversible actions; reply kindly.',
    )
  else
    hints.push(
      'No explicit customer confirmation in the thread. Two-stage cases stay in stage 1 (customerConfirmationNeeded: true).',
    )
  if (facts.latestPayment)
    hints.push(
      `Latest successful payment: ${facts.latestPayment.paymentIntentId ?? facts.latestPayment.chargeId} · ${(facts.latestPayment.amountCents / 100).toFixed(2)} ${facts.latestPayment.currency.toUpperCase()} on ${facts.latestPayment.date.slice(0, 10)} (${facts.daysSinceLatestPayment} days ago${facts.daysSinceLatestPayment != null && facts.daysSinceLatestPayment > 30 ? ', OUTSIDE the 30-day window' : ', inside the 30-day window'}).`,
    )
  else hints.push('No successful payment found in Stripe for this email.')
  if (facts.refundCount > 0)
    hints.push(
      `This customer already received ${facts.refundCount} refund(s): a second refund needs a valid reason (protocol).`,
    )
  if (facts.isLongTerm)
    hints.push(
      'Long-term customer (tag Long-term): an issue is high risk; act fast, consider a goodwill gesture.',
    )
  if (facts.isNewCustomer) hints.push('New customer (less than 30 days).')
  if (facts.trackedProfiles.length)
    hints.push(
      `Tracked profiles (${facts.trackedProfiles.length}): ${facts.trackedProfiles.map((p) => `@${p.handle}`).join(', ')}. Immediate cancellation deletes them.`,
    )
  if (input.researchWarnings.length)
    hints.push(`Research warnings from code (include them): ${input.researchWarnings.join(' · ')}`)
  if (input.knowledgeWarnings.length)
    hints.push(`Knowledge notes: ${input.knowledgeWarnings.join(' · ')}`)
  if (input.caseOverride)
    hints.push(
      `CASE OVERRIDE: the user picked the case "${input.caseOverride}" (${CASE_TYPES[input.caseOverride].label}). Use exactly this case.`,
    )
  if (trigger === 'release_notification' && input.release) {
    const iss = input.release.issue
    hints.push(
      `RELEASE NOTIFICATION for Linear issue ${input.release.identifier}${iss ? ` · "${iss.title}" · state ${iss.state}${iss.description ? ` · ${excerpt(iss.description, 1500)}` : ''}` : ' (issue details unavailable)'}. Case: release_notification. Draft the "it's live" email from the issue and the customer's original thread below. Actions: send_reply only.`,
    )
  }
  if (trigger === 'follow_up' && input.followUp)
    hints.push(
      `FOLLOW-UP: the ticket has been waiting on the customer${input.followUp.daysWaiting != null ? ` for ${input.followUp.daysWaiting} days` : ''}${input.followUp.waitingSince ? ` (since ${input.followUp.waitingSince.slice(0, 10)})` : ''}. Propose a short friendly follow-up, or a closing note when we already followed up once.`,
    )
  if (input.previousProposal) {
    const p = input.previousProposal
    hints.push(
      `Previous proposal (v${p.version}, ${p.status}): case ${p.caseType}, stage ${p.stage}, confirmation needed ${p.customerConfirmationNeeded}, actions ${p.actions.map((a) => `${a.type}@${a.stage}`).join(', ') || 'none'}. Summary: ${p.summaryLine}${p.reply ? `\nPrevious reply draft:\n"""\n${excerpt(p.reply.body, 3000)}\n"""` : ''}`,
    )
  }

  const sections = [
    `# Ticket #${ticket.displayNumber} · trigger: ${trigger}`,
    `Customer: ${ticket.customerName ?? '(no name)'} <${ticket.customerEmail}> · subject: ${ticket.subject ?? '(none)'} · status: ${ticket.status} · stage: ${ticket.stage} · current case: ${ticket.caseType ?? 'none'} · ticketId ${ticket.id}`,
    `Latest customer message received: ${latest?.receivedAt ?? latest?.createdAt ?? 'n/a'}`,
    '',
    '## Thread (oldest first)',
    threadSection(messages),
    '',
  ]
  if (input.release?.originalThread.length) {
    sections.push(
      '## Original thread of the customer (the report or request this release answers)',
      threadSection(input.release.originalThread),
      '',
    )
  }
  sections.push(
    '## Customer facts (derived by code)',
    factsSection(facts, now),
    '',
    '## Research bundle (fetched by code)',
    researchSection(input.research),
    '',
    '## Hints',
    hints.map((h) => `- ${h}`).join('\n'),
    '',
    '## Your task',
    `Decide whether this case needs research at all (see "How a run works"); fetch only what the rules require, in one turn, then call \`submit_proposal\` once with the complete proposal for ticket #${ticket.displayNumber}. Reply to ${ticket.customerEmail}.`,
  )
  return sections.join('\n')
}
