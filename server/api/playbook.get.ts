/**
 * GET /api/playbook — owner: IRDR-459. Read-only links into Notion: the Customer Support protocol,
 * the 17 templates with their actions, Examples and Knowledge Base with live counts through
 * NOTION_TOKEN (snapshot counts without it).
 */
import type { PlaybookResponse } from '#shared/api'
import { NOTION, TEMPLATE_CASE_TYPES, CASE_TYPES, notionPageUrl } from '#shared/case-types'
import { loadPlaybookCounts } from '../learning/notion-counts'

export default defineEventHandler(async (): Promise<PlaybookResponse> => {
  const support = notionPageUrl(NOTION.customerSupportPageId)
  const counts = await loadPlaybookCounts(process.env.NOTION_TOKEN)
  return {
    protocol: [
      { title: 'Persona & Tone', url: support },
      { title: 'Writing Principles', url: support },
      { title: 'Rules', url: support },
      { title: 'Actions', url: support },
    ],
    templates: TEMPLATE_CASE_TYPES.map((k) => {
      const c = CASE_TYPES[k]
      return {
        caseType: k,
        label: c.label,
        actions: [...c.defaultActions],
        requiresConfirmation: c.requiresConfirmation,
        url: c.notionPageId
          ? notionPageUrl(c.notionPageId)
          : notionPageUrl(NOTION.templatesDatabaseId),
      }
    }),
    examples: { count: counts.examples.total, url: notionPageUrl(NOTION.examplesDatabaseId) },
    examplesStatus: { active: counts.examples.active, draft: counts.examples.draft },
    knowledgeBase: {
      active: counts.knowledgeBase.active,
      draft: counts.knowledgeBase.draft,
      url: notionPageUrl(NOTION.knowledgeBaseDatabaseId),
    },
    liveCounts: counts.live,
  }
})
