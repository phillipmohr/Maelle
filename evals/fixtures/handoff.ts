/**
 * Hand-off (IRDR-477): the case is clear, but no template, rule or fact says how to answer. The
 * proposal keeps the real case, has no reply and no actions, and Phillip takes over.
 */
import type { Fixture } from './types'
import { TPL, ben, daysAgo } from './worlds'

const benWorld = ben()

export const HANDOFF_STORY_VIEWERS: Fixture = {
  id: 'handoff-story-viewers',
  title: 'Hand-off · Product question no instruction answers',
  group: 'case',
  customer: benWorld.customer,
  subject: 'Story viewers',
  messages: [
    {
      direction: 'in',
      text: 'Hi, quick question before I upgrade: can InstaRadar show me which accounts viewed the stories of a profile I track? And can I export that list for my agency report?',
      at: daysAgo(0, '08:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: benWorld.tools,
  scripted: {
    research: [],
    proposal: {
      case: 'product_question',
      confidence: 0.9,
      risk: { level: 'none', reason: null, dueDate: null },
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine:
        'Hand over: asks whether story viewers of a tracked profile can be seen and exported.',
      research: [
        {
          text: 'Ben is on Pro Monthly since September 20, 2026 and tracks no profile yet.',
          sources: [
            { kind: 'stripe', label: 'Stripe · sub_1BCart', ref: 'sub_1BCart' },
            { kind: 'supabase', label: 'Supabase · tracked_profiles', ref: 'tracked_profiles' },
          ],
        },
      ],
      actions: [],
      reply: null,
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.product_question,
          title: 'Product question (general)',
        },
      ],
      handoff: {
        reason:
          'Asks whether story viewers of a tracked profile can be seen and exported; no template or rule says what InstaRadar shows about stories.',
      },
    },
  },
  expect: {
    cases: ['product_question'],
    risk: 'none',
    actions: [],
    stage: 1,
    confirmationNeeded: false,
    noKnowledgeFound: false,
    handoff: true,
  },
}

export const HANDOFF_FIXTURES: Fixture[] = [HANDOFF_STORY_VIEWERS]
