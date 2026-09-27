/**
 * Maps Notion rows (Templates, Examples, Knowledge Base) and the Customer Support page into
 * `Knowledge`. Property lookups are case-insensitive and tolerant, because Notion property names
 * are edited by humans.
 */
import { NOTION, caseTypeFromLabel, notionPageUrl } from '#shared/case-types'
import type { NotionReadClient, NotionRow } from '../types'
import type { Knowledge, KnowledgeBaseEntry, KnowledgeExample, KnowledgeTemplate } from './types'

function prop(row: NotionRow, ...names: string[]): unknown {
  const keys = Object.keys(row.properties)
  for (const n of names) {
    const k = keys.find((x) => x.trim().toLowerCase() === n.toLowerCase())
    if (k !== undefined) return row.properties[k]
  }
  return undefined
}
const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null
  if (Array.isArray(v)) return v.map(String).join(', ') || null
  return null
}
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v ? [v] : []
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 'Yes'
const hasProp = (row: NotionRow, name: string) =>
  Object.keys(row.properties).some((k) => k.trim().toLowerCase() === name.toLowerCase())

export function templateFromRow(row: NotionRow): KnowledgeTemplate | null {
  const name = text(prop(row, 'Name', 'Title', 'Case'))
  if (!name) return null
  return {
    caseType: caseTypeFromLabel(name) ?? null,
    name,
    notionPageId: row.id.replace(/-/g, ''),
    url: row.url || notionPageUrl(row.id),
    trigger: text(prop(row, 'Trigger')) ?? '',
    actions: list(prop(row, 'Actions', 'Action')),
    requiresConfirmation: bool(prop(row, 'Requires confirmation', 'Requires Confirmation')),
    reply: text(prop(row, 'Reply', 'Reply template', 'Response')) ?? '',
    knowledgeBaseIds: list(prop(row, 'Knowledge Base', 'Knowledge base', 'KB')).map((id) =>
      id.replace(/-/g, ''),
    ),
  }
}

export function exampleFromRow(row: NotionRow): KnowledgeExample | null {
  const name = text(prop(row, 'Name', 'Title'))
  const message = text(prop(row, 'Customer message', 'Customer Message', 'Message'))
  if (!name || !message) return null
  return {
    notionPageId: row.id.replace(/-/g, ''),
    url: row.url || notionPageUrl(row.id),
    name,
    category: text(prop(row, 'Category')),
    customerMessage: message,
    response: text(prop(row, 'Response', 'Reply')),
    status: hasProp(row, 'Status') ? text(prop(row, 'Status')) : null,
  }
}

export function kbEntryFromRow(row: NotionRow): KnowledgeBaseEntry | null {
  const name = text(prop(row, 'Name', 'Title'))
  if (!name) return null
  return {
    notionPageId: row.id.replace(/-/g, ''),
    url: row.url || notionPageUrl(row.id),
    name,
    category: text(prop(row, 'Category')),
    type: text(prop(row, 'Type')),
    status: text(prop(row, 'Status')),
    app: list(prop(row, 'App', 'Apps', 'Product')),
    customerPhrasing: text(prop(row, 'Customer phrasing', 'Customer Phrasing')),
    shortAnswer: text(prop(row, 'Short answer', 'Short Answer', 'Answer')),
    lastVerified: text(prop(row, 'Last verified', 'Last Verified')),
    linearTicket: text(prop(row, 'Linear ticket', 'Linear Ticket', 'Linear')),
    relatedTemplateIds: list(prop(row, 'Related templates', 'Related Templates', 'Templates')).map(
      (id) => id.replace(/-/g, ''),
    ),
  }
}

/** Examples: only Active rows once the Status property exists; every row while it does not. */
export function filterActiveExamples(rows: KnowledgeExample[]): KnowledgeExample[] {
  return rows.filter((e) => e.status === null || e.status.toLowerCase() === 'active')
}

/** Knowledge base: Status = Active and App = InstaRadar. Draft and Outdated are never used. */
export function filterActiveKb(
  rows: KnowledgeBaseEntry[],
  app = 'InstaRadar',
): KnowledgeBaseEntry[] {
  return rows.filter(
    (e) =>
      (e.status ?? '').toLowerCase() === 'active' &&
      (e.app.length === 0 || e.app.some((a) => a.toLowerCase() === app.toLowerCase())),
  )
}

export async function loadKnowledgeFromNotion(
  notion: NotionReadClient,
  now: Date = new Date(),
): Promise<Knowledge> {
  const [protocol, templateRows, exampleRows, kbRows] = await Promise.all([
    notion.getPageText(NOTION.customerSupportPageId),
    notion.queryDataSource(NOTION.templatesCollectionId),
    notion.queryDataSource(NOTION.examplesCollectionId),
    notion.queryDataSource(NOTION.knowledgeBaseCollectionId),
  ])
  const templates = templateRows.map(templateFromRow).filter((t): t is KnowledgeTemplate => !!t)
  const warnings: string[] = []
  const unknown = templates.filter((t) => !t.caseType).map((t) => t.name)
  if (unknown.length)
    warnings.push(
      `Templates without a matching CaseType: ${unknown.join(', ')} (add them to shared/case-types.ts)`,
    )
  if (!protocol.trim()) warnings.push('The Customer Support page returned no text')
  return {
    source: 'notion',
    loadedAt: now.toISOString(),
    protocol,
    templates,
    examples: filterActiveExamples(
      exampleRows.map(exampleFromRow).filter((e): e is KnowledgeExample => !!e),
    ),
    knowledgeBase: filterActiveKb(
      kbRows.map(kbEntryFromRow).filter((e): e is KnowledgeBaseEntry => !!e),
    ),
    warnings,
  }
}
