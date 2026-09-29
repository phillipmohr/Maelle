import { describe, expect, it } from 'vitest'
import {
  applyThreshold,
  classificationSystemPrompt,
  classificationUserPrompt,
  createFakeClassifier,
  MAX_THREAD_CHARS,
  trimThread,
} from '../../server/mail/history-classify'
import { CASE_TYPE_KEYS } from '../../shared/case-types'

describe('history classification prompt', () => {
  it('names every case type with its trigger and asks for statistics only', () => {
    const s = classificationSystemPrompt()
    for (const key of CASE_TYPE_KEYS) expect(s).toContain(`\`${key}\``)
    expect(s).toMatch(/do not draft a reply/i)
    expect(s).not.toMatch(/—/)
  })

  it('renders the thread oldest first with who wrote what', () => {
    const u = classificationUserPrompt({
      ticketId: 't',
      subject: 'Refund please',
      customerEmail: 'a@example.com',
      customerName: 'Ada',
      messages: [
        { direction: 'in', at: '2026-03-01', text: 'I want a refund.' },
        { direction: 'out', at: '2026-03-02', text: 'Done.' },
      ],
    })
    expect(u).toContain('Subject: Refund please')
    expect(u).toContain('Customer: Ada <a@example.com>')
    expect(u.indexOf('CUSTOMER · 2026-03-01')).toBeLessThan(u.indexOf('SUPPORT · 2026-03-02'))
  })

  it('keeps the first message and the most recent ones within the budget', () => {
    const big = 'x'.repeat(2_500)
    const messages = Array.from({ length: 10 }, (_, i) => ({
      direction: 'in' as const,
      at: null,
      text: `${i}:${big}`,
    }))
    const kept = trimThread(messages)
    expect(kept[0]!.text.startsWith('0:')).toBe(true)
    expect(kept[kept.length - 1]!.text.startsWith('9:')).toBe(true)
    expect(kept.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(MAX_THREAD_CHARS)
    expect(kept.length).toBeLessThan(10)
    // A single very long message is clipped rather than dropped.
    expect(trimThread([{ direction: 'in', at: null, text: 'y'.repeat(9_000) }])[0]!.text).toMatch(
      /\[…\]$/,
    )
  })

  it('turns a low-confidence case into unclear, the same rule the agent follows', () => {
    expect(
      applyThreshold({ caseType: 'bug_report', confidence: 0.4, rationale: '' }).caseType,
    ).toBe('unclear')
    expect(
      applyThreshold({ caseType: 'bug_report', confidence: 0.6, rationale: '' }).caseType,
    ).toBe('bug_report')
  })

  it('the fake classifier records its calls and applies the threshold', async () => {
    const fake = createFakeClassifier({
      caseType: 'refund_request',
      confidence: 0.2,
      rationale: '',
    })
    const r = await fake.classify({
      ticketId: 't',
      subject: null,
      customerEmail: 'a@example.com',
      customerName: null,
      messages: [],
    })
    expect(r.caseType).toBe('unclear')
    expect(fake.calls).toHaveLength(1)
  })
})
