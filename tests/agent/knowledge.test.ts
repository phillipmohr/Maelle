import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEMPLATE_CASE_TYPES } from '../../shared/case-types'
import { createKnowledgeLoader } from '../../server/agent/knowledge/loader'
import {
  exampleFromRow,
  filterActiveExamples,
  filterActiveKb,
  kbEntryFromRow,
  loadKnowledgeFromNotion,
  templateFromRow,
} from '../../server/agent/knowledge/notion'
import { PROTOCOL_SNAPSHOT } from '../../server/agent/knowledge/protocol-snapshot'
import { loadSnapshotKnowledge, snapshotTemplates } from '../../server/agent/knowledge/snapshot'
import { createFakeNotionReadClient } from '../../server/agent/tools/notion'
import type { NotionRow } from '../../server/agent/types'
import { KB_DRAFT_ENTRY, KB_FOLLOWER_COUNT } from '../../evals/fixtures/worlds'

const ROOT = path.resolve(__dirname, '..', '..')

describe('knowledge snapshot', () => {
  it('embeds the protocol markdown verbatim (re-copy docs/notion/customer-support.md when it changes)', () => {
    const md = readFileSync(path.join(ROOT, 'docs', 'notion', 'customer-support.md'), 'utf8')
    expect(PROTOCOL_SNAPSHOT).toBe(md)
  })

  it('maps all 17 Notion templates to case types', () => {
    const templates = snapshotTemplates()
    expect(templates).toHaveLength(17)
    const keys = templates.map((t) => t.caseType)
    for (const k of TEMPLATE_CASE_TYPES) expect(keys).toContain(k)
    expect(templates.find((t) => t.caseType === 'refund_request')?.requiresConfirmation).toBe(true)
    expect(templates.find((t) => t.caseType === 'cancellation_only')?.reply).toMatch(
      /cancelled your subscription/,
    )
  })

  it('loads the snapshot with the 10 examples and an empty knowledge base', async () => {
    const k = await loadSnapshotKnowledge()
    expect(k.source).toBe('snapshot')
    expect(k.examples).toHaveLength(10)
    expect(k.knowledgeBase).toEqual([])
    expect(k.protocol).toMatch(/Never use em-dashes/)
  })
})

describe('knowledge filters', () => {
  it('keeps only Active examples once the Status property exists', () => {
    const rows = [
      {
        notionPageId: 'a',
        url: '',
        name: 'A',
        category: null,
        customerMessage: 'x',
        response: null,
        status: null,
      },
      {
        notionPageId: 'b',
        url: '',
        name: 'B',
        category: null,
        customerMessage: 'x',
        response: null,
        status: 'Active',
      },
      {
        notionPageId: 'c',
        url: '',
        name: 'C',
        category: null,
        customerMessage: 'x',
        response: null,
        status: 'Draft',
      },
    ]
    expect(filterActiveExamples(rows).map((r) => r.notionPageId)).toEqual(['a', 'b'])
  })

  it('keeps only Active InstaRadar knowledge base entries, never Draft or Outdated', () => {
    const rows = [
      KB_FOLLOWER_COUNT,
      KB_DRAFT_ENTRY,
      { ...KB_FOLLOWER_COUNT, notionPageId: 'out', status: 'Outdated' },
      { ...KB_FOLLOWER_COUNT, notionPageId: 'other-app', app: ['OtherApp'] },
      { ...KB_FOLLOWER_COUNT, notionPageId: 'no-app', app: [] },
    ]
    expect(filterActiveKb(rows).map((r) => r.notionPageId)).toEqual([
      KB_FOLLOWER_COUNT.notionPageId,
      'no-app',
    ])
  })
})

describe('notion row mapping', () => {
  const templateRow: NotionRow = {
    id: '3e8c931f-6ae5-8142-9b0e-cd9c9abee871',
    url: 'https://app.notion.com/p/3e8c931f6ae581429b0ecd9c9abee871',
    properties: {
      Name: 'Cancellation only',
      Trigger: 'Customer wants to cancel.',
      Actions: ['Cancel at period end', 'Research in Stripe/Supabase/Vercel'],
      'Requires confirmation': false,
      Reply: 'Hi, thanks for reaching out!',
      'Knowledge Base': ['abc-def'],
    },
  }

  it('maps a template row and resolves the case type from the name', () => {
    const t = templateFromRow(templateRow)!
    expect(t.caseType).toBe('cancellation_only')
    expect(t.notionPageId).toBe('3e8c931f6ae581429b0ecd9c9abee871')
    expect(t.actions).toContain('Cancel at period end')
    expect(t.knowledgeBaseIds).toEqual(['abcdef'])
  })

  it('maps examples and knowledge base rows tolerantly', () => {
    const e = exampleFromRow({
      id: 'x',
      url: '',
      properties: { Name: 'E', Category: 'Question', 'Customer message': 'Hi?', Status: 'Active' },
    })!
    expect(e.status).toBe('Active')
    const noStatus = exampleFromRow({
      id: 'y',
      url: '',
      properties: { Name: 'E', 'Customer message': 'Hi?' },
    })!
    expect(noStatus.status).toBeNull()
    const kb = kbEntryFromRow({
      id: 'k',
      url: '',
      properties: { Name: 'KB', Status: 'Active', App: 'InstaRadar', 'Short answer': 'Because.' },
    })!
    expect(kb.app).toEqual(['InstaRadar'])
    expect(kb.shortAnswer).toBe('Because.')
    expect(templateFromRow({ id: 'z', url: '', properties: {} })).toBeNull()
  })

  it('loads knowledge from a (fake) Notion and warns about templates without a case key', async () => {
    const notion = createFakeNotionReadClient({
      dataSources: {
        '3e8c931f-6ae5-8071-98a0-000befdd6354': [
          templateRow,
          {
            ...templateRow,
            id: 'new',
            properties: { ...templateRow.properties, Name: 'Brand new template' },
          },
        ],
        '3e8c931f-6ae5-801d-a2f5-000b1ba7f580': [
          {
            id: 'e1',
            url: '',
            properties: { Name: 'Ex', 'Customer message': 'Hello', Status: 'Inactive' },
          },
        ],
        '3e8c931f-6ae5-80fb-9152-000bf28ecfbd': [
          { id: 'k1', url: '', properties: { Name: 'KB', Status: 'Active', App: ['InstaRadar'] } },
        ],
      },
      pages: { '3e8c931f6ae58012a0a7ec9a1adb4259': '# Protocol\n- Never use em-dashes' },
    })
    const k = await loadKnowledgeFromNotion(notion)
    expect(k.source).toBe('notion')
    expect(k.templates).toHaveLength(2)
    expect(k.examples).toHaveLength(0)
    expect(k.knowledgeBase).toHaveLength(1)
    expect(k.protocol).toMatch(/em-dashes/)
    expect(k.warnings.join(' ')).toMatch(/Brand new template/)
  })
})

describe('knowledge loader', () => {
  it('falls back to the snapshot with a warning when Notion is not configured', async () => {
    const loader = createKnowledgeLoader({ notion: null })
    const k = await loader.load()
    expect(k.source).toBe('snapshot')
    expect(k.warnings.join(' ')).toMatch(/NOTION_TOKEN/)
  })

  it('falls back to the snapshot when Notion fails, and caches for the TTL', async () => {
    const notion = createFakeNotionReadClient({}, { fail: 'boom' })
    let t = 0
    const loader = createKnowledgeLoader({ notion, ttlMs: 1000, now: () => new Date(t) })
    const first = await loader.load()
    expect(first.source).toBe('snapshot')
    expect(first.warnings.join(' ')).toMatch(/Notion unavailable \(boom\)/)
    const calls = notion.calls.length
    await loader.load()
    expect(notion.calls.length).toBe(calls) // cached
    t = 2000
    await loader.load()
    expect(notion.calls.length).toBeGreaterThan(calls) // expired
    loader.reset()
    await loader.load({ force: true })
  })

  it('uses Notion when it works', async () => {
    const notion = createFakeNotionReadClient({
      dataSources: {},
      pages: { '3e8c931f6ae58012a0a7ec9a1adb4259': 'Protocol text' },
    })
    const k = await createKnowledgeLoader({ notion }).load()
    expect(k.source).toBe('notion')
    expect(k.protocol).toBe('Protocol text')
  })
})
