/** What the learning loop reads from a ticket, and the learning_events it records. */
import type { LearningResponse } from '#shared/api'
import { CASE_TYPES, isCaseType, type CaseType } from '#shared/case-types'
import { dbOne, dbQuery } from '../utils/db'
import { iso, isUuid } from '../autonomy/app'

type Row = Record<string, unknown>

export type LearningKind = 'example' | 'kb_draft'

export interface LearningTicketContext {
  ticket: {
    id: string
    displayNumber: number
    subject: string | null
    customerName: string | null
    customerEmail: string
    caseType: CaseType | null
    status: string
  }
  /** The customer's first message, in English when a translation exists. */
  customerMessage: string
  /** The final reply: the last sent message, or the approved reply draft when nothing was sent yet. */
  reply: string | null
  replySource: 'sent' | 'draft' | null
  noKnowledgeFound: boolean
  /** Notion page id of the case template (relation "Related templates"). */
  templateNotionPageId: string | null
}

export async function loadLearningContext(
  idOrNumber: string,
): Promise<LearningTicketContext | null> {
  const t = await dbOne<Row>(
    isUuid(idOrNumber)
      ? 'select * from public.tickets where id = $1'
      : 'select * from public.tickets where display_number = $1::int',
    [isUuid(idOrNumber) ? idOrNumber : idOrNumber.replace(/^#/, '')],
  )
  if (!t) return null
  const ticketId = String(t.id)
  const [inbound, outbound, proposal] = await Promise.all([
    dbOne<Row>(
      `select text_body, translation from public.messages where ticket_id = $1 and direction = 'in' order by created_at asc limit 1`,
      [ticketId],
    ),
    dbOne<Row>(
      `select text_body from public.messages where ticket_id = $1 and direction = 'out' order by created_at desc limit 1`,
      [ticketId],
    ),
    dbOne<Row>(
      `select reply_draft, no_knowledge_found, case_type from public.proposals where ticket_id = $1 order by version desc limit 1`,
      [ticketId],
    ),
  ])
  const caseType = isCaseType(t.case_type)
    ? t.case_type
    : isCaseType(proposal?.case_type)
      ? proposal!.case_type
      : null
  const draft =
    (proposal?.reply_draft as { body?: string; templateNotionPageId?: string | null } | null) ??
    null
  const sent = (outbound?.text_body as string | null) ?? null
  return {
    ticket: {
      id: ticketId,
      displayNumber: Number(t.display_number),
      subject: (t.subject as string | null) ?? null,
      customerName: (t.customer_name as string | null) ?? null,
      customerEmail: String(t.customer_email),
      caseType,
      status: String(t.status),
    },
    customerMessage: String(inbound?.translation ?? inbound?.text_body ?? '').trim(),
    reply: sent?.trim() || draft?.body?.trim() || null,
    replySource: sent?.trim() ? 'sent' : draft?.body?.trim() ? 'draft' : null,
    noKnowledgeFound: Boolean(proposal?.no_knowledge_found),
    templateNotionPageId:
      draft?.templateNotionPageId ?? (caseType ? CASE_TYPES[caseType].notionPageId : null),
  }
}

export async function findLearningEvent(
  ticketId: string,
  kind: LearningKind,
): Promise<LearningResponse | null> {
  const row = await dbOne<Row>(
    'select notion_page_id, notion_url, created_at from public.learning_events where ticket_id = $1 and kind = $2',
    [ticketId, kind],
  )
  if (!row) return null
  return { notionPageId: String(row.notion_page_id), url: String(row.notion_url), existing: true }
}

export async function recordLearningEvent(
  ticketId: string,
  kind: LearningKind,
  page: { id: string; url: string },
  createdBy: string,
): Promise<void> {
  await dbQuery(
    `insert into public.learning_events (ticket_id, kind, notion_page_id, notion_url, created_by)
     values ($1, $2, $3, $4, $5)
     on conflict (ticket_id, kind) do nothing`,
    [ticketId, kind, page.id, page.url, createdBy],
  )
}

export { iso }
