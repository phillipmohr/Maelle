/**
 * "Create KB draft": Claude condenses the final reply into a Knowledge Base entry (Status Draft,
 * App InstaRadar, Related templates = the case template). The deterministic fallback runs without a key.
 */
import { NOTION, caseLabel, type CaseType } from '#shared/case-types'
import type { KbCategory, KbCondensation, KbType, ModelClient } from './model-client'
import { block, prop, type NotionPageInput } from './notion-writer'
import type { LearningTicketContext } from './repo'

const KB_CATEGORY_BY_CASE: Record<CaseType, KbCategory> = {
  cancellation_only: 'Plans & pricing',
  cancellation_reason_ask: 'Plans & pricing',
  refund_request: 'Billing & payments',
  cancellation_refund_deletion: 'Billing & payments',
  account_deletion: 'Account & access',
  second_refund_request: 'Billing & payments',
  feature_request: 'Features',
  bug_report: 'Tracking & scans',
  unsatisfied_customer: 'Plans & pricing',
  billing_question: 'Billing & payments',
  chargeback: 'Billing & payments',
  charged_after_cancellation: 'Billing & payments',
  product_question: 'Tracking & scans',
  data_accuracy: 'Data & accuracy',
  safety_removal: 'Privacy & safety',
  outage_access: 'Account & access',
  cannot_cancel: 'Account & access',
  release_notification: 'Features',
  unclear: 'Features',
}

const KB_TYPE_BY_CASE: Record<CaseType, KbType> = {
  cancellation_only: 'Policy',
  cancellation_reason_ask: 'Policy',
  refund_request: 'Policy',
  cancellation_refund_deletion: 'Policy',
  account_deletion: 'Policy',
  second_refund_request: 'Policy',
  feature_request: 'Explanation',
  bug_report: 'Known issue',
  unsatisfied_customer: 'Policy',
  billing_question: 'Explanation',
  chargeback: 'Policy',
  charged_after_cancellation: 'Explanation',
  product_question: 'Explanation',
  data_accuracy: 'Explanation',
  safety_removal: 'Policy',
  outage_access: 'Known issue',
  cannot_cancel: 'How-to',
  release_notification: 'Explanation',
  unclear: 'Explanation',
}

export function kbCategoryFor(caseType: CaseType | null): KbCategory {
  return caseType ? KB_CATEGORY_BY_CASE[caseType] : 'Features'
}

export function kbTypeFor(caseType: CaseType | null): KbType {
  return caseType ? KB_TYPE_BY_CASE[caseType] : 'Explanation'
}

export async function buildKbDraftPage(
  ctx: LearningTicketContext & { reply: string },
  model: ModelClient,
  now: Date = new Date(),
): Promise<{ page: NotionPageInput; condensation: KbCondensation }> {
  const condensation = await model.condenseKnowledge({
    subject: ctx.ticket.subject,
    caseLabel: ctx.ticket.caseType ? caseLabel(ctx.ticket.caseType) : 'Unclassified',
    customerMessage: ctx.customerMessage,
    reply: ctx.reply,
    suggestedCategory: kbCategoryFor(ctx.ticket.caseType),
    suggestedType: kbTypeFor(ctx.ticket.caseType),
  })
  const properties: NotionPageInput['properties'] = {
    Name: prop.title(condensation.name),
    Category: prop.select(condensation.category),
    Type: prop.select(condensation.type),
    Status: prop.select('Draft'),
    App: prop.select('InstaRadar'),
    'Customer phrasing': prop.richText(condensation.customerPhrasing),
    'Short answer': prop.richText(condensation.shortAnswer),
  }
  if (ctx.templateNotionPageId) {
    properties['Related templates'] = prop.relation([ctx.templateNotionPageId])
  }
  return {
    condensation,
    page: {
      dataSourceId: NOTION.knowledgeBaseCollectionId,
      properties,
      children: [
        block.paragraph(
          `Draft from Maelle · ticket #${ctx.ticket.displayNumber} · ${now.toISOString().slice(0, 10)} · condensed ${model.kind === 'anthropic' ? `by ${model.model}` : 'without a model call'}. Verify the facts, then set Status to Active.`,
        ),
        block.heading2('Customer message'),
        block.quote(ctx.customerMessage || '(no text)'),
        block.heading2('Final reply'),
        block.paragraph(ctx.reply),
      ],
    },
  }
}
