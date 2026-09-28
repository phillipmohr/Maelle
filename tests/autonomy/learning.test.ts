import { describe, expect, it } from 'vitest'
import { NOTION } from '../../shared/case-types'
import { buildExamplePage, exampleCategoryFor, exampleName } from '../../server/learning/examples'
import { buildKbDraftPage, kbCategoryFor, kbTypeFor } from '../../server/learning/kb-draft'
import {
  cleanSubject,
  condenseDeterministically,
  createFallbackModelClient,
  sentences,
  stripReplyBoilerplate,
} from '../../server/learning/model-client'
import { chunkText, createFakeNotionWriter, propText } from '../../server/learning/notion-writer'
import { LearningError, createKbDraft, saveExample, type LearningDeps } from '../../server/learning'
import type { LearningTicketContext } from '../../server/learning/repo'

const REPLY =
  "Hi Jonas, thanks for reaching out, I'd like to get to the bottom of this!\n\nI looked at @weber.woodworks: the count went up by 38 this week, and 31 of those new followers are private accounts. Instagram includes them in the total, but they never appear in the visible follower list, so the count moves while the list looks unchanged. Your list is accurate, it just cannot show private accounts.\n\nIf you saw something else that looked off, tell me where (the count at the top, the follower list, or an event in your timeline) and I'll check it right away.\n\nBest regards,\nAnastasia\nInstaRadar Support"

const ctx: LearningTicketContext = {
  ticket: {
    id: 'b8a6e8f0-0000-4000-8000-000000004819',
    displayNumber: 4819,
    subject: 'Re: Follower count does not add up',
    customerName: 'Jonas Weber',
    customerEmail: 'jonas.weber@gmx.net',
    caseType: 'data_accuracy',
    status: 'closed',
  },
  customerMessage:
    "The follower count keeps going up but nothing new shows up. I don't trust that it's accurate.",
  reply: REPLY,
  replySource: 'sent',
  noKnowledgeFound: true,
  templateNotionPageId: '3e8c931f6ae581f3b55be4fc0ebd1597',
}

function deps(overrides: Partial<LearningDeps> = {}) {
  const writer = createFakeNotionWriter()
  const events = new Map<string, { notionPageId: string; url: string }>()
  const d: LearningDeps = {
    writer,
    model: createFallbackModelClient(),
    loadContext: async (id) => (id === ctx.ticket.id || id === '4819' ? ctx : null),
    findEvent: async (ticketId, kind) => events.get(`${ticketId}:${kind}`) ?? null,
    recordEvent: async (ticketId, kind, page) => {
      events.set(`${ticketId}:${kind}`, { notionPageId: page.id, url: page.url })
    },
    now: () => new Date('2026-09-27T10:00:00Z'),
    ...overrides,
  }
  return { d, writer, events }
}

describe('examples', () => {
  it('maps case types to the Examples categories', () => {
    expect(exampleCategoryFor('cancellation_only')).toBe('Cancellation')
    expect(exampleCategoryFor('refund_request')).toBe('Refund request')
    expect(exampleCategoryFor('chargeback')).toBe('Billing dispute')
    expect(exampleCategoryFor('safety_removal')).toBe('Safety / removal')
    expect(exampleCategoryFor('feature_request')).toBe('Feedback / feature request')
    expect(exampleCategoryFor(null)).toBe('Question')
  })

  it('builds a Draft page with every field filled', () => {
    const page = buildExamplePage({ ...ctx, reply: REPLY })
    expect(page.dataSourceId).toBe(NOTION.examplesCollectionId)
    expect(exampleName(ctx)).toBe('Question, follower count does not add up')
    expect(propText(page.properties.Name)).toBe('Question, follower count does not add up')
    expect(propText(page.properties.Category)).toBe('Question')
    expect(propText(page.properties['Customer message'])).toBe(ctx.customerMessage)
    expect(propText(page.properties.Response)).toBe(REPLY)
    expect(propText(page.properties.Status)).toBe('Draft')
    expect(page.children?.length).toBe(1)
  })
})

describe('knowledge base condensation', () => {
  it('splits sentences and strips greeting and sign-off', () => {
    expect(sentences('One. Two! Three? Four')).toEqual(['One.', 'Two!', 'Three?', 'Four'])
    const body = stripReplyBoilerplate(REPLY)
    expect(body.startsWith('I looked at @weber.woodworks')).toBe(true)
    expect(body).not.toContain('Best regards')
    expect(body).not.toContain('If you saw something else')
    expect(cleanSubject('Re: Fwd: Refund')).toBe('Refund')
  })

  it('condenses deterministically without em dashes', () => {
    const c = condenseDeterministically({
      subject: ctx.ticket.subject,
      caseLabel: 'Data accuracy concern',
      customerMessage: ctx.customerMessage,
      reply: REPLY,
      suggestedCategory: 'Data & accuracy',
      suggestedType: 'Explanation',
    })
    expect(c.name).toBe('Follower count does not add up')
    expect(c.category).toBe('Data & accuracy')
    expect(c.type).toBe('Explanation')
    expect(c.customerPhrasing).toBe(ctx.customerMessage)
    expect(
      c.shortAnswer.startsWith('I looked at @weber.woodworks: the count went up by 38 this week'),
    ).toBe(true)
    expect(c.shortAnswer.length).toBeLessThanOrEqual(400)
    expect(c.shortAnswer).not.toMatch(/[—―]/)
    expect(kbCategoryFor('data_accuracy')).toBe('Data & accuracy')
    expect(kbTypeFor('bug_report')).toBe('Known issue')
    expect(kbTypeFor('cannot_cancel')).toBe('How-to')
  })

  it('builds the KB draft page with Status Draft, App InstaRadar and the related template', async () => {
    const { page, condensation } = await buildKbDraftPage(
      { ...ctx, reply: REPLY },
      createFallbackModelClient(),
    )
    expect(page.dataSourceId).toBe(NOTION.knowledgeBaseCollectionId)
    expect(propText(page.properties.Name)).toBe(condensation.name)
    expect(propText(page.properties.Status)).toBe('Draft')
    expect(propText(page.properties.App)).toBe('InstaRadar')
    expect(propText(page.properties.Category)).toBe('Data & accuracy')
    expect(propText(page.properties.Type)).toBe('Explanation')
    expect(propText(page.properties['Customer phrasing'])).toBe(ctx.customerMessage)
    expect(propText(page.properties['Short answer'])).toBe(condensation.shortAnswer)
    expect(page.properties['Related templates']).toEqual({
      relation: [{ id: '3e8c931f6ae581f3b55be4fc0ebd1597' }],
    })
    expect(page.children?.length).toBeGreaterThan(3)
  })

  it('chunks long rich text at 2000 characters', () => {
    const chunks = chunkText('x'.repeat(4500))
    expect(chunks.map((c) => c.length)).toEqual([2000, 2000, 500])
  })
})

describe('learning service', () => {
  it('creates the example once and returns the existing page afterwards', async () => {
    const { d, writer } = deps()
    const first = await saveExample(d, '4819', 'phillip@example.com')
    expect(first).toMatchObject({ existing: false, writer: 'fake' })
    expect(writer.pages).toHaveLength(1)
    const again = await saveExample(d, ctx.ticket.id, 'phillip@example.com')
    expect(again).toMatchObject({
      existing: true,
      notionPageId: first.notionPageId,
      url: first.url,
    })
    expect(writer.pages).toHaveLength(1)
  })

  it('creates the KB draft with the fallback model', async () => {
    const { d, writer } = deps()
    const res = await createKbDraft(d, ctx.ticket.id, 'phillip@example.com')
    expect(res.writer).toBe('fake')
    expect(writer.pages[0]!.dataSourceId).toBe(NOTION.knowledgeBaseCollectionId)
    expect(propText(writer.pages[0]!.properties.Status)).toBe('Draft')
  })

  it('refuses without a reply or an unknown ticket', async () => {
    const { d } = deps({ loadContext: async () => ({ ...ctx, reply: null, replySource: null }) })
    await expect(saveExample(d, ctx.ticket.id, 'x')).rejects.toBeInstanceOf(LearningError)
    await expect(saveExample(d, ctx.ticket.id, 'x')).rejects.toMatchObject({ statusCode: 409 })
    const missing = deps({ loadContext: async () => null })
    await expect(createKbDraft(missing.d, 'nope', 'x')).rejects.toMatchObject({ statusCode: 404 })
  })
})
