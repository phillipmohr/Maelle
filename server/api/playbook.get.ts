/**
 * GET /api/playbook — owner: IRDR-459. Already real: links into Notion from the shared contracts.
 * The autonomy ticket adds live Examples / Knowledge Base counts through NOTION_READ_TOKEN.
 */
import type { PlaybookResponse } from '#shared/api'
import { NOTION, TEMPLATE_CASE_TYPES, CASE_TYPES, notionPageUrl } from '#shared/case-types'

export default defineEventHandler((): PlaybookResponse => {
  const support = notionPageUrl(NOTION.customerSupportPageId)
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
    examples: { count: 10, url: notionPageUrl(NOTION.examplesDatabaseId) },
    knowledgeBase: { active: 0, draft: 0, url: notionPageUrl(NOTION.knowledgeBaseDatabaseId) },
  }
})
