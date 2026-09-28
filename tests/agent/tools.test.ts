import { describe, expect, it } from 'vitest'
import { createFakeTools } from '../../server/agent/tools'
import {
  TOOL_SOURCE,
  allToolDefinitions,
  compactJson,
  executeResearchTool,
  submitProposalInputSchema,
} from '../../server/agent/tools/definitions'
import { SELECT_MAX_ROWS, extractHandles, guardSelect } from '../../server/agent/tools/instaradar'
import { searchTerms } from '../../server/agent/tools/linear'
import { plainProperty } from '../../server/agent/tools/notion'
import { loadStripeBundle } from '../../server/agent/tools/stripe'
import { matchesLogQuery } from '../../server/agent/tools/vercel'
import { candidateEmailsFor, extractEmails, extractNameHints } from '../../server/agent/research'
import { DEFAULT_INSTARADAR_TABLES } from '../../server/agent/config'
import { priya, rachel } from '../../evals/fixtures/worlds'

describe('guarded SELECT', () => {
  it('accepts a single select and forces a limit', () => {
    expect(guardSelect('select * from public.scans where user_id = 1')).toBe(
      `select * from public.scans where user_id = 1 limit ${SELECT_MAX_ROWS}`,
    )
    expect(guardSelect('SELECT id FROM t LIMIT 5;')).toBe('SELECT id FROM t LIMIT 5')
    expect(guardSelect(`select id from t limit ${SELECT_MAX_ROWS + 500}`)).toBe(
      `select id from t limit ${SELECT_MAX_ROWS}`,
    )
    expect(guardSelect('with x as (select 1) select * from x')).toMatch(/limit/)
  })

  it('rejects anything that is not one plain select', () => {
    expect(() => guardSelect('delete from t')).toThrow(/Only a single SELECT/)
    expect(() => guardSelect('select 1; drop table t')).toThrow(/semicolons/)
    expect(() => guardSelect('select 1 -- comment')).toThrow(/Comments/)
    expect(() => guardSelect('select pg_sleep(10)')).toThrow(/Forbidden keyword/)
    expect(() => guardSelect('select * from t for update')).toThrow(/Row locks|Forbidden/)
    expect(() => guardSelect('select * into new_t from t')).toThrow(/SELECT INTO/)
    expect(() => guardSelect("select set_config('x','y',false)")).toThrow(/Forbidden keyword/)
    expect(() => guardSelect('select * from t limit all')).toThrow(/LIMIT must be/)
  })
})

describe('text extraction helpers', () => {
  it('extracts instagram handles', () => {
    expect(
      extractHandles('It happened 6 times for @studio.kolo and @Kolo.Ceramics. Mail me at a@b.co'),
    ).toEqual(['studio.kolo', 'kolo.ceramics'])
  })
  it('extracts emails and name hints', () => {
    expect(
      extractEmails(
        'Our member Rachel Kim (rachel.kim@gmail.com) disputes. Reply to Support@InstaRadar.app',
      ),
    ).toEqual(['rachel.kim@gmail.com', 'support@instaradar.app'])
    expect(
      extractNameHints(
        'Our member Rachel Kim has disputed three charges. The cardholder: John Ronald Smith.',
      ),
    ).toEqual(['Rachel Kim', 'John Ronald Smith'])
    const emails = candidateEmailsFor({ customerEmail: 'disputes@pvcu.org' }, [
      {
        direction: 'in',
        textBody: 'member Rachel Kim (rachel.kim@gmail.com), cc support@instaradar.app',
        subject: null,
        createdAt: '2026-01-01T00:00:00Z',
      } as never,
    ])
    expect(emails).toEqual(['disputes@pvcu.org', 'rachel.kim@gmail.com'])
  })
  it('picks search terms for Linear', () => {
    expect(searchTerms('I keep getting post deleted alerts but nothing is deleted')).toEqual(
      expect.arrayContaining(['deleted', 'alerts', 'post']),
    )
    expect(searchTerms('the a an')).toEqual([])
  })
  it('flattens notion properties', () => {
    expect(
      plainProperty({ type: 'title', title: [{ plain_text: 'A' }, { plain_text: 'B' }] }),
    ).toBe('AB')
    expect(plainProperty({ type: 'multi_select', multi_select: [{ name: 'x' }] })).toEqual(['x'])
    expect(plainProperty({ type: 'checkbox', checkbox: true })).toBe(true)
    expect(plainProperty({ type: 'status', status: { name: 'Active' } })).toBe('Active')
    expect(plainProperty({ type: 'relation', relation: [{ id: 'r1' }] })).toEqual(['r1'])
    expect(plainProperty(null)).toBeNull()
  })
  it('filters log lines', () => {
    const line = {
      at: '2026-09-25T00:00:00Z',
      level: 'warning' as const,
      source: 'scan-worker',
      message: 'media 404 for @studio.kolo (user=usr_1)',
      requestId: null,
    }
    expect(matchesLogQuery(line, { since: '2026-09-20T00:00:00Z', handle: '@studio.kolo' })).toBe(
      true,
    )
    expect(matchesLogQuery(line, { since: '2026-09-26T00:00:00Z' })).toBe(false)
    expect(matchesLogQuery(line, { since: '2026-09-20T00:00:00Z', level: 'error' })).toBe(false)
    expect(matchesLogQuery(line, { since: '2026-09-20T00:00:00Z', userId: 'usr_1' })).toBe(true)
    expect(matchesLogQuery(line, { since: '2026-09-20T00:00:00Z', text: 'nope' })).toBe(false)
  })
  it('truncates huge tool results', () => {
    const s = compactJson({ big: 'x'.repeat(50_000) }, 1000)
    expect(s.length).toBeLessThan(1200)
    expect(s).toMatch(/truncated/)
  })
})

describe('tool definitions', () => {
  it('lists the research tools plus submit_proposal with a JSON schema of the proposal', () => {
    const defs = allToolDefinitions(DEFAULT_INSTARADAR_TABLES)
    const names = defs.map((d) => d.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'stripe_events',
        'stripe_search_customers',
        'instaradar_select',
        'vercel_logs',
        'linear_search',
        'notion_page',
        'email_history',
        'submit_proposal',
      ]),
    )
    for (const n of names) if (n !== 'submit_proposal') expect(TOOL_SOURCE[n]).toBeDefined()
    const schema = submitProposalInputSchema() as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'case',
        'confidence',
        'risk',
        'customerConfirmationNeeded',
        'summaryLine',
        'reply',
      ]),
    )
    expect(Object.keys(schema.properties)).toContain('translations')
    expect(JSON.stringify(schema)).not.toContain('$schema')
    expect(defs.find((d) => d.name === 'instaradar_select')?.description).toContain(
      'public.profiles',
    )
  })
})

describe('tool dispatch', () => {
  const world = priya()
  const tools = createFakeTools(world.tools)
  const ctx = { tools, now: new Date('2026-09-27T10:00:00Z'), emailHistory: async () => [] }

  it('runs a research tool and reports its source', async () => {
    const out = await executeResearchTool(
      'vercel_logs',
      { handle: 'studio.kolo', sinceDays: 14 },
      ctx,
    )
    expect(out.isError).toBe(false)
    expect(out.source).toBe('vercel')
    expect(JSON.parse(out.content).count).toBe(17)
    const lin = await executeResearchTool('linear_search', { query: 'post deleted alerts' }, ctx)
    expect(JSON.parse(lin.content).issues[0].identifier).toBe('INS-198')
  })

  it('reports invalid input, unknown tools and failing clients as tool errors, never throws', async () => {
    expect((await executeResearchTool('vercel_logs', { sinceDays: 'many' }, ctx)).isError).toBe(
      true,
    )
    expect((await executeResearchTool('nope', {}, ctx)).isError).toBe(true)
    const failing = createFakeTools(world.tools, { stripe: { fail: 'stripe down' } })
    const out = await executeResearchTool(
      'stripe_events',
      { customerId: 'cus_x' },
      { ...ctx, tools: failing },
    )
    expect(out.isError).toBe(true)
    expect(out.content).toMatch(/stripe down/)
    const sel = await executeResearchTool(
      'instaradar_select',
      { sql: 'drop table x', purpose: 'evil' },
      ctx,
    )
    expect(sel.isError).toBe(true)
    expect(sel.content).toMatch(/Only a single SELECT/)
  })

  it('finds a customer through a mentioned email or a name hint', async () => {
    const r = createFakeTools(rachel().tools)
    const byEmail = await loadStripeBundle(
      r.stripe,
      ['disputes@pvcu.org', 'rachel.kim@gmail.com'],
      null,
    )
    expect(byEmail.customer?.id).toBe('cus_RKim4417')
    expect(byEmail.disputes).toHaveLength(3)
    const byName = await loadStripeBundle(r.stripe, ['disputes@pvcu.org'], null, ['Rachel Kim'])
    expect(byName.customer?.id).toBe('cus_RKim4417')
    const none = await loadStripeBundle(r.stripe, ['nobody@example.com'], null, ['Nobody'])
    expect(none.customer).toBeNull()
  })
})
