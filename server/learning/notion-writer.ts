/**
 * Notion writes go through this interface only. The real adapter uses NOTION_TOKEN, an
 * integration with insert content and no update or delete, so Maelle can create pages but never
 * change or remove existing ones. The fake keeps pages in memory: tests, and every environment
 * without the token.
 */
import { Client } from '@notionhq/client'
import { notionPageUrl } from '#shared/case-types'
import { deterministicUuid } from '#shared/utils/ids'

type CreatePageArgs = Parameters<Client['pages']['create']>[0]

/** Notion caps one rich text item at 2000 characters. */
export const NOTION_TEXT_LIMIT = 2000

export type NotionProperty = Record<string, unknown>
export type NotionBlock = Record<string, unknown>

export interface NotionPageInput {
  dataSourceId: string
  properties: Record<string, NotionProperty>
  children?: NotionBlock[]
}

export interface CreatedNotionPage {
  id: string
  url: string
}

export interface NotionWriter {
  readonly kind: 'notion' | 'fake'
  createPage(input: NotionPageInput): Promise<CreatedNotionPage>
}

export function chunkText(text: string, size = NOTION_TEXT_LIMIT): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > size) {
    out.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  out.push(rest)
  return out
}

function richText(text: string) {
  return chunkText(text).map((content) => ({ type: 'text', text: { content } }))
}

/** Property values in the Notion API shape. */
export const prop = {
  title: (text: string): NotionProperty => ({
    title: [{ type: 'text', text: { content: text.slice(0, NOTION_TEXT_LIMIT) } }],
  }),
  richText: (text: string): NotionProperty => ({ rich_text: richText(text) }),
  select: (name: string): NotionProperty => ({ select: { name } }),
  relation: (pageIds: string[]): NotionProperty => ({ relation: pageIds.map((id) => ({ id })) }),
  date: (isoDate: string): NotionProperty => ({ date: { start: isoDate } }),
  url: (url: string): NotionProperty => ({ url }),
}

/** Block objects for the page body. */
export const block = {
  heading2: (text: string): NotionBlock => ({
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: richText(text) },
  }),
  paragraph: (text: string): NotionBlock => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(text) },
  }),
  quote: (text: string): NotionBlock => ({
    object: 'block',
    type: 'quote',
    quote: { rich_text: richText(text) },
  }),
}

/** Plain text of a title / rich_text property, or the select name (for tests and logs). */
export function propText(p: NotionProperty | undefined): string {
  if (!p) return ''
  const items = (p.title ?? p.rich_text) as { text?: { content?: string } }[] | undefined
  if (Array.isArray(items)) return items.map((i) => i.text?.content ?? '').join('')
  const select = p.select as { name?: string } | undefined
  if (select?.name) return select.name
  if (typeof p.url === 'string') return p.url
  return ''
}

export function createNotionWriter(token: string, opts: { timeoutMs?: number } = {}): NotionWriter {
  const client = new Client({ auth: token, timeoutMs: opts.timeoutMs ?? 20_000 })
  return {
    kind: 'notion',
    async createPage(input) {
      const res = await client.pages.create({
        parent: { type: 'data_source_id', data_source_id: input.dataSourceId },
        properties: input.properties as CreatePageArgs['properties'],
        children: input.children as CreatePageArgs['children'],
      })
      const url = 'url' in res && typeof res.url === 'string' ? res.url : notionPageUrl(res.id)
      return { id: res.id, url }
    },
  }
}

export interface FakeNotionPage extends NotionPageInput, CreatedNotionPage {
  createdAt: string
}

export function createFakeNotionWriter(): NotionWriter & { pages: FakeNotionPage[] } {
  const pages: FakeNotionPage[] = []
  return {
    kind: 'fake',
    pages,
    async createPage(input) {
      const id = deterministicUuid(`fake-notion:${pages.length}:${Date.now()}:${Math.random()}`)
      const page: FakeNotionPage = {
        ...input,
        id,
        url: notionPageUrl(id),
        createdAt: new Date().toISOString(),
      }
      pages.push(page)
      return { id, url: page.url }
    },
  }
}

let fromEnv: NotionWriter | null = null

/** The real writer when NOTION_TOKEN is set, the fake otherwise. */
export function notionWriterFromEnv(env: NodeJS.ProcessEnv = process.env): NotionWriter {
  if (fromEnv) return fromEnv
  const token = env.NOTION_TOKEN
  fromEnv = token ? createNotionWriter(token) : createFakeNotionWriter()
  return fromEnv
}

/** Tests only. */
export function resetNotionWriterForTests(): void {
  fromEnv = null
}
