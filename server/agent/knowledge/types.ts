import type { CaseType } from '#shared/case-types'

export interface KnowledgeTemplate {
  /** Resolved from the Notion name (the source of truth for CaseType); null when unknown. */
  caseType: CaseType | null
  name: string
  notionPageId: string
  url: string
  trigger: string
  /** Notion "Actions" options, executable ones and research ones alike. */
  actions: string[]
  requiresConfirmation: boolean
  reply: string
  /** Related Knowledge Base page ids. */
  knowledgeBaseIds: string[]
}

export interface KnowledgeExample {
  notionPageId: string
  url: string
  name: string
  category: string | null
  customerMessage: string
  response: string | null
  /** Set once the autonomy ticket adds the Status property; null means "no property". */
  status: string | null
}

export interface KnowledgeBaseEntry {
  notionPageId: string
  url: string
  name: string
  category: string | null
  type: string | null
  status: string | null
  app: string[]
  customerPhrasing: string | null
  shortAnswer: string | null
  lastVerified: string | null
  linearTicket: string | null
  relatedTemplateIds: string[]
}

export interface Knowledge {
  source: 'notion' | 'snapshot'
  loadedAt: string
  /** The Customer Support page (Actions, Protocol: Persona & Tone, Writing Principles, Rules) as markdown. */
  protocol: string
  templates: KnowledgeTemplate[]
  /** Active examples only (all rows while the Status property does not exist). */
  examples: KnowledgeExample[]
  /** Status = Active and App = InstaRadar only. Draft and Outdated entries are never loaded. */
  knowledgeBase: KnowledgeBaseEntry[]
  warnings: string[]
}
