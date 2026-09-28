/**
 * The docs/notion snapshot as Knowledge. Used when NOTION_READ_TOKEN is missing or Notion fails,
 * and by tests and evals. The JSON files are bundled by the build; the protocol markdown is embedded
 * in protocol-snapshot.ts (kept in sync by a test).
 */
import { caseTypeFromLabel } from '#shared/case-types'
import examplesJson from '../../../docs/notion/examples.json'
import templatesJson from '../../../docs/notion/templates.json'
import { PROTOCOL_SNAPSHOT } from './protocol-snapshot'
import type { Knowledge, KnowledgeBaseEntry, KnowledgeExample, KnowledgeTemplate } from './types'

const pageIdFromUrl = (url: string) => url.split('/').pop()!.replace(/-/g, '')

export function snapshotTemplates(): KnowledgeTemplate[] {
  return templatesJson.templates.map((t) => ({
    caseType: caseTypeFromLabel(t.name) ?? null,
    name: t.name,
    notionPageId: pageIdFromUrl(t.url),
    url: t.url,
    trigger: t.trigger,
    actions: t.actions,
    requiresConfirmation: t.requiresConfirmation,
    reply: t.reply,
    knowledgeBaseIds: [],
  }))
}

export function snapshotExamples(): KnowledgeExample[] {
  return examplesJson.examples.map((e) => ({
    notionPageId: pageIdFromUrl(e.url),
    url: e.url,
    name: e.name,
    category: e.category,
    customerMessage: e.customerMessage,
    response: null,
    status: null,
  }))
}

/**
 * The snapshot of the Knowledge Base has no rows (the database was empty on 2026-09-27), so
 * `noKnowledgeFound` is true for most cases until Phillip fills it. Tests inject entries.
 */
export async function loadSnapshotKnowledge(
  opts: { knowledgeBase?: KnowledgeBaseEntry[] } = {},
): Promise<Knowledge> {
  return {
    source: 'snapshot',
    loadedAt: '2026-09-27T00:00:00.000Z',
    protocol: PROTOCOL_SNAPSHOT,
    templates: snapshotTemplates(),
    examples: snapshotExamples(),
    knowledgeBase: opts.knowledgeBase ?? [],
    warnings: [],
  }
}
