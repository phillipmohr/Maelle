/**
 * "Save as example?": a Draft page in the Notion Examples DB from the customer message and the
 * final reply. Drafts are not used by the agent until Phillip sets Status to Active.
 */
import { NOTION, caseShortLabel, type CaseType } from '#shared/case-types'
import { cleanSubject } from './model-client'
import { block, prop, type NotionPageInput } from './notion-writer'
import type { LearningTicketContext } from './repo'

export const EXAMPLE_CATEGORIES = [
  'Refund request',
  'Cancellation',
  'Bug report',
  'Feedback / feature request',
  'Question',
  'Billing dispute',
  'Safety / removal',
] as const
export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number]

const CATEGORY_BY_CASE: Record<CaseType, ExampleCategory> = {
  cancellation_only: 'Cancellation',
  cancellation_reason_ask: 'Cancellation',
  refund_request: 'Refund request',
  cancellation_refund_deletion: 'Refund request',
  account_deletion: 'Cancellation',
  second_refund_request: 'Refund request',
  feature_request: 'Feedback / feature request',
  bug_report: 'Bug report',
  unsatisfied_customer: 'Feedback / feature request',
  billing_question: 'Billing dispute',
  chargeback: 'Billing dispute',
  charged_after_cancellation: 'Billing dispute',
  product_question: 'Question',
  data_accuracy: 'Question',
  safety_removal: 'Safety / removal',
  outage_access: 'Bug report',
  cannot_cancel: 'Cancellation',
  release_notification: 'Feedback / feature request',
  unclear: 'Question',
}

export function exampleCategoryFor(caseType: CaseType | null): ExampleCategory {
  return caseType ? CATEGORY_BY_CASE[caseType] : 'Question'
}

/** "Cancellation, unsubscribe" in the style of the existing example names. */
export function exampleName(ctx: LearningTicketContext): string {
  const category = exampleCategoryFor(ctx.ticket.caseType)
  const subject = cleanSubject(ctx.ticket.subject)
  const detail = subject
    ? subject[0]!.toLowerCase() + subject.slice(1)
    : ctx.ticket.caseType
      ? caseShortLabel(ctx.ticket.caseType).toLowerCase()
      : `ticket #${ctx.ticket.displayNumber}`
  return `${category}, ${detail}`.replace(/[.?!]+$/, '').slice(0, 100)
}

export function buildExamplePage(
  ctx: LearningTicketContext & { reply: string },
  now: Date = new Date(),
): NotionPageInput {
  return {
    dataSourceId: NOTION.examplesCollectionId,
    properties: {
      Name: prop.title(exampleName(ctx)),
      Category: prop.select(exampleCategoryFor(ctx.ticket.caseType)),
      'Customer message': prop.richText(ctx.customerMessage),
      Response: prop.richText(ctx.reply),
      Status: prop.select('Draft'),
    },
    children: [
      block.paragraph(
        `Saved from Maelle · ticket #${ctx.ticket.displayNumber} · ${ctx.ticket.customerName ?? ctx.ticket.customerEmail} · ${now.toISOString().slice(0, 10)}. Set Status to Active once the reply is worth imitating.`,
      ),
    ],
  }
}
