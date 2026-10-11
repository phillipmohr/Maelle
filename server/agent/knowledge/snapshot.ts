/**
 * The docs/notion snapshot as Knowledge. Used when NOTION_TOKEN is missing or Notion fails,
 * and by tests and evals. The JSON files are bundled by the build; the protocol markdown is embedded
 * in protocol-snapshot.ts (kept in sync by a test).
 */
import { caseTypeFromLabel } from '#shared/case-types'
import { KNOWLEDGE_BASE } from '#shared/config'
import examplesJson from '../../../docs/notion/examples.json'
import templatesJson from '../../../docs/notion/templates.json'
import { filterActiveExamples } from './notion'
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

/** The Active examples, like the live loader (the Draft ones stay in the file as eval fixtures). */
export function snapshotExamples(): KnowledgeExample[] {
  return filterActiveExamples(
    examplesJson.examples.map((e) => {
      const row = e as typeof e & { response?: string; status?: string }
      return {
        notionPageId: pageIdFromUrl(e.url),
        url: e.url,
        name: e.name,
        category: e.category,
        customerMessage: e.customerMessage,
        response: row.response ?? null,
        status: row.status ?? null,
      }
    }),
  )
}

/**
 * The snapshot of the Knowledge Base has no rows (the database was empty on 2026-09-27). The
 * Knowledge Base is off by default (`KNOWLEDGE_BASE.enabled`); tests switch it on and inject entries.
 */
export async function loadSnapshotKnowledge(
  opts: { knowledgeBase?: KnowledgeBaseEntry[]; knowledgeBaseEnabled?: boolean } = {},
): Promise<Knowledge> {
  const knowledgeBaseEnabled = opts.knowledgeBaseEnabled ?? KNOWLEDGE_BASE.enabled
  return {
    source: 'snapshot',
    loadedAt: '2026-10-11T00:00:00.000Z',
    protocol: PROTOCOL_SNAPSHOT,
    templates: snapshotTemplates(),
    examples: snapshotExamples(),
    knowledgeBase: knowledgeBaseEnabled ? (opts.knowledgeBase ?? []) : [],
    knowledgeBaseEnabled,
    warnings: [],
  }
}
