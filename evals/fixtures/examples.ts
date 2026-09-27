/**
 * The 10 Notion Examples (docs/notion/examples.json) as fixtures. Several reuse a case fixture's
 * world and scripted proposal with the example's wording; three have their own world.
 */
import type { ProposalInput, SourceChip } from '#shared/proposal'
import examplesJson from '../../docs/notion/examples.json'
import {
  CASE_1_CANCELLATION,
  CASE_2_REFUND,
  CASE_3_CHARGEBACK,
  CASE_4_BUG,
  CASE_5_FEATURE,
  CASE_6_SAFETY,
  CASE_7_DATA_ACCURACY,
} from './cases'
import type { Fixture } from './types'
import { KB_PRIVATE_PROFILES, KB_PAGES, TPL, ben, daysAgo, kate, nina } from './worlds'

const src = (kind: SourceChip['kind'], label: string, ref?: string): SourceChip => ({
  kind,
  label,
  ref,
})
const because = (s: string) => `Because: ${s}`
const none: ProposalInput['risk'] = { level: 'none', reason: null, dueDate: null }

const example = (name: string) => {
  const e = examplesJson.examples.find((x) => x.name === name)
  if (!e) throw new Error(`Example not in snapshot: ${name}`)
  return e
}

/** Same world and scripted proposal as a case fixture, but the example's customer message. */
function variant(
  base: Fixture,
  id: string,
  exampleName: string,
  opts: { subject?: string; message?: string } = {},
): Fixture {
  const e = example(exampleName)
  return {
    ...base,
    id,
    title: `Example · ${e.name}`,
    group: 'example',
    subject: opts.subject ?? base.subject,
    messages: [
      { direction: 'in', text: opts.message ?? e.customerMessage, at: daysAgo(0, '08:00:00') },
    ],
    followUp: undefined,
  }
}

const EX_1 = variant(
  CASE_1_CANCELLATION,
  'example-1-cancellation',
  'Cancellation, ask for the reason',
)

const ninaWorld = nina()
const EX_2: Fixture = {
  id: 'example-2-vague-cancellation-feedback',
  title: 'Example · Cancellation, vague reason, ask before acting',
  group: 'example',
  customer: ninaWorld.customer,
  subject: 'Cancellation feedback',
  messages: [
    {
      direction: 'in',
      text: example('Cancellation, vague reason, ask before acting').customerMessage,
      at: daysAgo(0, '08:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: ninaWorld.tools,
  scripted: {
    research: [],
    proposal: {
      case: 'data_accuracy',
      confidence: 0.82,
      risk: none,
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine:
        'Store the cancellation reason, ask what exactly looked off before explaining. No refund.',
      research: [
        {
          text: 'Nina cancelled through the app on September 26; the Pro Monthly subscription ends on October 20, 2026 and no refund was requested.',
          sources: [src('stripe', 'Stripe · sub_1NPetr', 'sub_1NPetr')],
        },
        {
          text: 'The reason "inaccurate, not chronological" is vague: the protocol says ask what exactly seemed off and where before explaining or refunding.',
          sources: [src('notion', 'Notion · Rules', '3e8c931f6ae58012a0a7ec9a1adb4259')],
        },
        {
          text: 'One tracked profile (@petrova.art), 18 sign-ins in the last months, no errors in the scans.',
          sources: [src('supabase', 'Supabase · tracked_profiles', 'tracked_profiles')],
        },
      ],
      actions: [
        {
          type: 'store_cancellation_reason',
          params: {
            stripeCustomerId: 'cus_NPetrova5511',
            stripeSubscriptionId: 'sub_1NPetr',
            feedback: 'low_quality',
            comment: 'inaccurate. Message: the followers/following are not chronological.',
          },
          reason: because('every cancellation reason is logged for win-back offers'),
        },
        {
          type: 'send_reply',
          params: { to: 'nina.petrova@gmail.com' },
          reason: because('a vague reason is clarified before explaining'),
        },
      ],
      reply: {
        template: 'Data accuracy concern',
        templateNotionPageId: TPL.data_accuracy,
        to: 'nina.petrova@gmail.com',
        subject: 'Re: Cancellation feedback',
        body: "Hi Nina, thanks for reaching out, and thank you for telling us why you cancelled. I'd like to get to the bottom of this!\n\nCould you tell me what exactly looked off and where you saw it? For example the order of the follower list at the top, the follower list in a manual check, or an event in your activity timeline for @petrova.art. A screenshot helps a lot.\n\nOnce I know, I'll check it right away and get back to you. Your subscription stays active until October 20, 2026, so you can keep using it while we look into this.\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.data_accuracy, title: 'Data accuracy concern' },
      ],
      noKnowledgeFound: true,
    },
  },
  expect: {
    cases: ['data_accuracy', 'cancellation_reason_ask', 'unsatisfied_customer'],
    risk: 'none',
    actionsMustInclude: ['send_reply'],
    actionsMustExclude: ['refund_latest_payment', 'cancel_immediately', 'delete_account'],
    stage: 1,
    confirmationNeeded: false,
  },
}

const EX_3 = variant(
  CASE_2_REFUND,
  'example-3-refund-unused',
  'Refund request, within 30 days, unused',
)

const EX_4 = variant(
  CASE_3_CHARGEBACK,
  'example-4-bank-chargeback',
  'Billing, bank chargeback with Stripe timeline',
  {
    message:
      "[From the member's credit union] Our member Rachel Kim (rachel.kim@gmail.com) disputes three charges and states she cancelled three weeks ago but is still being charged. Please refund to avoid the chargeback process.",
  },
)
EX_4.expect = { ...CASE_3_CHARGEBACK.expect, dueDate: undefined, dueDateIs: undefined }

const kateWorld = kate()
const EX_5: Fixture = {
  id: 'example-5-catch-up-charges',
  title: 'Example · Billing, catch-up charges after failed payments',
  group: 'example',
  customer: kateWorld.customer,
  subject: 'Charged 3 times?!',
  messages: [
    {
      direction: 'in',
      text: example('Billing, catch-up charges after failed payments').customerMessage,
      at: daysAgo(0, '08:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: kateWorld.tools,
  scripted: {
    research: [{ name: 'stripe_retrieve', input: { id: 'in_KM08' } }],
    proposal: {
      case: 'billing_question',
      confidence: 0.93,
      risk: none,
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine:
        'Explain the two catch-up payments for the failed July and August invoices. Reply only.',
      research: [
        {
          text: 'The July 21 and August 21 payments failed (card declined) and were collected on September 17 and 19 as catch-up payments after retries; September 21 is the regular renewal.',
          sources: [
            src('stripe', 'Stripe · in_KM07', 'in_KM07'),
            src('stripe', 'in_KM08', 'in_KM08'),
            src('stripe', 'in_KMs01', 'in_KMs01'),
          ],
        },
        {
          text: 'Kate was billed once per month in total; no duplicate charge, nothing to refund.',
          sources: [src('stripe', 'Stripe · cus_KMorgan5540', 'cus_KMorgan5540')],
        },
        {
          text: 'The account stayed active and was used during the failed-payment weeks (9 sign-ins).',
          sources: [src('supabase', 'Supabase · sessions', 'sessions')],
        },
      ],
      conclusion:
        'Three charges in one week are two catch-up payments plus the regular renewal, not a triple charge.',
      actions: [
        {
          type: 'send_reply',
          params: { to: 'kate.morgan@yahoo.com' },
          reason: because('all three charges are legitimate'),
        },
      ],
      reply: {
        template: 'Billing question / disputed charge',
        templateNotionPageId: TPL.billing_question,
        to: 'kate.morgan@yahoo.com',
        subject: 'Re: Charged 3 times?!',
        body: "Hi Kate, thanks for reaching out, I understand why three charges in one week looked alarming!\n\nI checked your account: the $7.99 charges on September 17 and September 19 are the payments for July 21 and August 21 that your card declined at the time and that went through later, once your bank accepted them. The charge on September 21 is your regular Pro Monthly renewal. So you were billed once per month in total, the two older payments just caught up in the same week.\n\nYou can see every payment with its date on your billing page: https://www.instaradar.app/portal/settings/billing\n\nLet me know if anything still doesn't add up, I'm happy to take another look!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.billing_question,
          title: 'Billing question / disputed charge',
        },
      ],
      noKnowledgeFound: true,
    },
  },
  expect: {
    cases: ['billing_question'],
    risk: 'none',
    actions: ['send_reply'],
    actionsMustExclude: ['refund_latest_payment'],
    stage: 1,
    confirmationNeeded: false,
  },
}

const benWorld = ben()
const EX_6: Fixture = {
  id: 'example-6-private-profile',
  title: 'Example · Question, private profile not accessible',
  group: 'example',
  customer: benWorld.customer,
  subject: 'Private profiles',
  messages: [
    {
      direction: 'in',
      text: example('Question, private profile not accessible').customerMessage,
      at: daysAgo(0, '08:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: benWorld.tools,
  knowledgeBase: [KB_PRIVATE_PROFILES],
  scripted: {
    research: [{ name: 'notion_page', input: { pageId: KB_PAGES.privateProfiles } }],
    proposal: {
      case: 'product_question',
      confidence: 0.95,
      risk: none,
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine: 'Explain that private profiles cannot be tracked on any plan. Reply only.',
      research: [
        {
          text: 'Knowledge base: private profiles cannot be tracked on any plan, even when the customer follows them.',
          sources: [
            src(
              'kb',
              'Knowledge base · Private profiles cannot be tracked',
              KB_PAGES.privateProfiles,
            ),
          ],
        },
        {
          text: 'Ben is on Pro Monthly since September 20, 2026 and tracks no profile yet.',
          sources: [
            src('stripe', 'Stripe · sub_1BCart', 'sub_1BCart'),
            src('supabase', 'Supabase · tracked_profiles', 'tracked_profiles'),
          ],
        },
      ],
      actions: [
        {
          type: 'send_reply',
          params: { to: 'ben.carter@proton.me' },
          reason: because('the answer is in the knowledge base'),
        },
      ],
      reply: {
        template: 'Product question (general)',
        templateNotionPageId: TPL.product_question,
        to: 'ben.carter@proton.me',
        subject: 'Re: Private profiles',
        body: "Hi Ben, thanks for reaching out, happy to help!\n\nPrivate profiles cannot be tracked on any plan, even if you follow them. InstaRadar only works with information that is publicly visible on Instagram, so a private account's follower list is not available to us.\n\nIf the account ever switches to public, you can start tracking it right away and every change from that day on is recorded.\n\nLet me know if anything else comes up, I'm always glad to help!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.product_question,
          title: 'Product question (general)',
        },
        {
          kind: 'kb',
          notionPageId: KB_PAGES.privateProfiles,
          title: 'Private profiles cannot be tracked',
        },
      ],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['product_question'],
    risk: 'none',
    actions: ['send_reply'],
    stage: 1,
    confirmationNeeded: false,
    noKnowledgeFound: false,
  },
}

const EX_7 = variant(
  CASE_7_DATA_ACCURACY,
  'example-7-follower-count',
  'Question, fluctuating follower count',
)
const EX_8 = variant(
  CASE_5_FEATURE,
  'example-8-file-names',
  'Feature request, log and notify at release',
  { subject: 'File names' },
)
EX_8.scripted = {
  ...CASE_5_FEATURE.scripted,
  proposal: {
    ...CASE_5_FEATURE.scripted.proposal,
    reply: { ...CASE_5_FEATURE.scripted.proposal.reply!, subject: 'Re: File names' },
  },
}
const EX_9 = variant(
  CASE_4_BUG,
  'example-9-false-deletion-alerts',
  'Bug report, false post-deletion alerts',
  { subject: 'Posts being deleted?' },
)
EX_9.scripted = {
  research: [
    { name: 'vercel_logs', input: { userId: 'usr_pnair_0b7d', sinceDays: 14, level: 'warning' } },
    { name: 'linear_search', input: { query: 'post deleted alerts' } },
  ],
  proposal: {
    ...CASE_4_BUG.scripted.proposal,
    reply: { ...CASE_4_BUG.scripted.proposal.reply!, subject: 'Re: Posts being deleted?' },
  },
}
const EX_10 = variant(
  CASE_6_SAFETY,
  'example-10-safety-removal',
  'Safety / removal, act immediately',
  { subject: 'Removal request' },
)
EX_10.scripted = {
  ...CASE_6_SAFETY.scripted,
  proposal: {
    ...CASE_6_SAFETY.scripted.proposal,
    reply: { ...CASE_6_SAFETY.scripted.proposal.reply!, subject: 'Re: Removal request' },
  },
}

export const EXAMPLE_FIXTURES: Fixture[] = [
  EX_1,
  EX_2,
  EX_3,
  EX_4,
  EX_5,
  EX_6,
  EX_7,
  EX_8,
  EX_9,
  EX_10,
]
