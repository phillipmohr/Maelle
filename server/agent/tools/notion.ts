/**
 * Notion, read only. Constructed with NOTION_TOKEN (or NOTION_READ_TOKEN, an integration with "read content" only).
 * The interface has two reads: the rows of a data source (Templates, Examples, Knowledge Base) and
 * the plain text of a page (template body or KB entry).
 */
import { Client, collectPaginatedAPI, isFullBlock, isFullPage } from '@notionhq/client'
import type { NotionReadClient, NotionRow } from '../types'
import type { FakeOptions } from './stripe'

type Obj = Record<string, unknown>

/** Flattens a Notion property value (title, rich_text, select, multi_select, status, checkbox, relation, url, date, number) to a plain value. */
export function plainProperty(prop: unknown): unknown {
  const p = prop as Obj | null | undefined
  if (!p || typeof p !== 'object') return null
  const type = p.type as string | undefined
  const richText = (arr: unknown) =>
    Array.isArray(arr) ? arr.map((t) => String((t as Obj).plain_text ?? '')).join('') : ''
  switch (type) {
    case 'title':
      return richText(p.title)
    case 'rich_text':
      return richText(p.rich_text)
    case 'select':
      return (p.select as Obj | null)?.name ?? null
    case 'status':
      return (p.status as Obj | null)?.name ?? null
    case 'multi_select':
      return Array.isArray(p.multi_select) ? p.multi_select.map((o) => String((o as Obj).name)) : []
    case 'checkbox':
      return Boolean(p.checkbox)
    case 'relation':
      return Array.isArray(p.relation) ? p.relation.map((r) => String((r as Obj).id)) : []
    case 'url':
      return p.url ?? null
    case 'email':
      return p.email ?? null
    case 'number':
      return p.number ?? null
    case 'date':
      return (p.date as Obj | null)?.start ?? null
    case 'people':
      return Array.isArray(p.people)
        ? p.people.map((u) => String((u as Obj).name ?? (u as Obj).id))
        : []
    case 'created_time':
      return p.created_time ?? null
    case 'last_edited_time':
      return p.last_edited_time ?? null
    default:
      return null
  }
}

function blockText(block: Obj): string {
  const type = block.type as string
  const inner = block[type] as Obj | undefined
  const rich = Array.isArray(inner?.rich_text)
    ? (inner!.rich_text as Obj[]).map((t) => String(t.plain_text ?? '')).join('')
    : ''
  switch (type) {
    case 'heading_1':
      return `# ${rich}`
    case 'heading_2':
      return `## ${rich}`
    case 'heading_3':
      return `### ${rich}`
    case 'bulleted_list_item':
      return `- ${rich}`
    case 'numbered_list_item':
      return `1. ${rich}`
    case 'to_do':
      return `- [${inner?.checked ? 'x' : ' '}] ${rich}`
    case 'quote':
      return `> ${rich}`
    case 'callout':
      return `> ${rich}`
    case 'code':
      return '```\n' + rich + '\n```'
    case 'divider':
      return '---'
    case 'paragraph':
    case 'toggle':
      return rich
    default:
      return rich
  }
}

export function createNotionReadClient(token: string): NotionReadClient {
  const notion = new Client({ auth: token, timeoutMs: 20_000 })
  return {
    configured: true,
    async queryDataSource(dataSourceId) {
      const pages = await collectPaginatedAPI(notion.dataSources.query, {
        data_source_id: dataSourceId,
        page_size: 100,
      })
      return pages.filter(isFullPage).map((page) => ({
        id: page.id.replace(/-/g, ''),
        url: page.url,
        properties: Object.fromEntries(
          Object.entries(page.properties).map(([k, v]) => [k, plainProperty(v)]),
        ),
      }))
    },
    async getPageText(pageId) {
      const blocks = await collectPaginatedAPI(notion.blocks.children.list, {
        block_id: pageId,
        page_size: 100,
      })
      const lines: string[] = []
      for (const b of blocks) {
        if (!isFullBlock(b)) continue
        const text = blockText(b as unknown as Obj)
        if (text) lines.push(text)
        // One level of children (e.g. bullet sub-points) is enough for templates and KB entries.
        if (b.has_children) {
          const children = await collectPaginatedAPI(notion.blocks.children.list, {
            block_id: b.id,
            page_size: 100,
          })
          for (const c of children) {
            if (!isFullBlock(c)) continue
            const t = blockText(c as unknown as Obj)
            if (t) lines.push(`  ${t}`)
          }
        }
      }
      return lines.join('\n')
    },
  }
}

export function createFakeNotionReadClient(
  data: { dataSources?: Record<string, NotionRow[]>; pages?: Record<string, string> } = {},
  opts: FakeOptions = {},
): NotionReadClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    configured: !opts.unconfigured,
    async queryDataSource(id) {
      calls.push(`query:${id}`)
      if (opts.fail) throw new Error(opts.fail)
      return data.dataSources?.[id] ?? data.dataSources?.[id.replace(/-/g, '')] ?? []
    },
    async getPageText(pageId) {
      calls.push(`page:${pageId}`)
      if (opts.fail) throw new Error(opts.fail)
      const key = pageId.replace(/-/g, '')
      return data.pages?.[key] ?? data.pages?.[pageId] ?? ''
    },
  }
}
