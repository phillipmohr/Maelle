import { describe, expect, it } from 'vitest'
import {
  buildStripeTimeline,
  money,
  renderStripeTimelineSvg,
} from '../../server/agent/attachments/stripe-timeline'
import { createMemoryAttachmentStore } from '../../server/agent/attachments/store'
import { loadStripeBundle } from '../../server/agent/tools/stripe'
import { createFakeTools } from '../../server/agent/tools'
import { rachel } from '../../evals/fixtures/worlds'

describe('stripe timeline attachment', () => {
  it('builds rows from subscriptions, charges, refunds and disputes in time order', async () => {
    const tools = createFakeTools(rachel().tools)
    const bundle = await loadStripeBundle(tools.stripe, ['rachel.kim@gmail.com'], null)
    const rows = buildStripeTimeline(bundle)
    expect(rows[0]).toMatchObject({ label: 'Subscribed · Pro Monthly', id: 'sub_1OxK2a' })
    expect(rows.filter((r) => r.kind === 'bad').map((r) => r.label)).toEqual(
      expect.arrayContaining(['Charge · disputed', 'Dispute opened · subscription_canceled']),
    )
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.at >= rows[i - 1]!.at).toBe(true)
  })

  it('renders deterministic, well-formed SVG', () => {
    const input = {
      title: 'Stripe activity · Rachel Kim',
      subtitle: 'cus_RKim4417',
      rows: [
        {
          at: '2026-05-04T09:00:00.000Z',
          label: 'Charge · disputed <test> & "quotes"',
          amount: '$7.99',
          id: 'ch_3PqL',
          kind: 'bad' as const,
        },
        {
          at: '2026-03-18T09:14:00.000Z',
          label: 'Cancelled',
          amount: null,
          id: 'sub_1OxK2a',
          kind: 'muted' as const,
        },
      ],
      generatedAt: '2026-09-27T10:00:00.000Z',
    }
    const a = renderStripeTimelineSvg(input)
    const b = renderStripeTimelineSvg(input)
    expect(a).toBe(b)
    expect(a.startsWith('<?xml')).toBe(true)
    expect(a).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(a).toContain('&lt;test&gt; &amp; &quot;quotes&quot;')
    expect(a).toContain('May 4, 2026')
    expect(a).toContain('Sep 27, 2026')
    expect(a).not.toContain('—')
  })

  it('stores through the attachment store', async () => {
    const store = createMemoryAttachmentStore()
    const stored = await store.put('tickets/t1/timeline.svg', '<svg/>', 'image/svg+xml')
    expect(stored).toEqual({
      storagePath: 'tickets/t1/timeline.svg',
      sizeBytes: 6,
      contentType: 'image/svg+xml',
    })
    expect(store.files.get('tickets/t1/timeline.svg')?.body.toString()).toBe('<svg/>')
  })

  it('formats money', () => {
    expect(money(1307, 'usd')).toBe('$13.07')
    expect(money(799, 'eur')).toBe('€7.99')
    expect(money(500, 'gbp')).toBe('GBP 5.00')
  })
})
