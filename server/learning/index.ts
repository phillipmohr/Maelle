/**
 * The learning loop: Save as example and Create KB draft. Both are idempotent per ticket
 * (learning_events), both create Draft pages only, and both work with the fake writer when
 * NOTION_TOKEN is missing.
 */
import type { LearningResponse } from '#shared/api'
import { buildExamplePage } from './examples'
import { buildKbDraftPage } from './kb-draft'
import { modelClientFromEnv, type ModelClient } from './model-client'
import { notionWriterFromEnv, type CreatedNotionPage, type NotionWriter } from './notion-writer'
import {
  findLearningEvent,
  loadLearningContext,
  recordLearningEvent,
  type LearningKind,
  type LearningTicketContext,
} from './repo'

export class LearningError extends Error {
  readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'LearningError'
    this.statusCode = statusCode
  }
}

export interface LearningDeps {
  writer: NotionWriter
  model: ModelClient
  loadContext: (ticketId: string) => Promise<LearningTicketContext | null>
  findEvent: (ticketId: string, kind: LearningKind) => Promise<LearningResponse | null>
  recordEvent: (
    ticketId: string,
    kind: LearningKind,
    page: CreatedNotionPage,
    createdBy: string,
  ) => Promise<void>
  now?: () => Date
}

export function defaultLearningDeps(): LearningDeps {
  return {
    writer: notionWriterFromEnv(),
    model: modelClientFromEnv(),
    loadContext: loadLearningContext,
    findEvent: findLearningEvent,
    recordEvent: recordLearningEvent,
  }
}

async function prepare(
  deps: LearningDeps,
  ticketId: string,
  kind: LearningKind,
): Promise<
  | { existing: LearningResponse }
  | { existing: null; ctx: LearningTicketContext & { reply: string } }
> {
  const ctx = await deps.loadContext(ticketId)
  if (!ctx) throw new LearningError(404, 'Ticket not found')
  const existing = await deps.findEvent(ctx.ticket.id, kind)
  if (existing) return { existing: { ...existing, existing: true, writer: deps.writer.kind } }
  if (!ctx.reply) {
    throw new LearningError(409, 'No reply to learn from yet. Approve or send a reply first.')
  }
  if (!ctx.customerMessage) {
    throw new LearningError(409, 'The customer message has no text to learn from.')
  }
  return { existing: null, ctx: { ...ctx, reply: ctx.reply } }
}

export async function saveExample(
  deps: LearningDeps,
  ticketId: string,
  createdBy: string,
): Promise<LearningResponse> {
  const prepared = await prepare(deps, ticketId, 'example')
  if (prepared.existing) return prepared.existing
  const page = await deps.writer.createPage(buildExamplePage(prepared.ctx, deps.now?.()))
  await deps.recordEvent(prepared.ctx.ticket.id, 'example', page, createdBy)
  return { notionPageId: page.id, url: page.url, existing: false, writer: deps.writer.kind }
}

export async function createKbDraft(
  deps: LearningDeps,
  ticketId: string,
  createdBy: string,
): Promise<LearningResponse> {
  const prepared = await prepare(deps, ticketId, 'kb_draft')
  if (prepared.existing) return prepared.existing
  const { page: input } = await buildKbDraftPage(prepared.ctx, deps.model, deps.now?.())
  const page = await deps.writer.createPage(input)
  await deps.recordEvent(prepared.ctx.ticket.id, 'kb_draft', page, createdBy)
  return { notionPageId: page.id, url: page.url, existing: false, writer: deps.writer.kind }
}
