/**
 * The 7 test cases from the project description. Each carries what a competent model would submit
 * (the scripted run exercises the loop, the tools, the finaliser and the write path) and what the
 * final proposal must look like (checked for the scripted run and for the live model).
 */
import type { ProposalInput, SourceChip } from '#shared/proposal'
import type { Fixture } from './types'
import {
  KB_DRAFT_ENTRY,
  KB_FOLLOWER_COUNT,
  KB_PAGES,
  TPL,
  daysAgo,
  jonas,
  liam,
  marco,
  priya,
  rachel,
  sara,
  tom,
} from './worlds'

const src = (kind: SourceChip['kind'], label: string, ref?: string): SourceChip => ({
  kind,
  label,
  ref,
})
const because = (s: string) => `Because: ${s}`
const risk = (level: ProposalInput['risk']['level'] = 'none'): ProposalInput['risk'] => ({
  level,
  reason: null,
  dueDate: null,
})

// ---------------------------------------------------------------- 1 · cancellation only

const tomWorld = tom()
export const CASE_1_CANCELLATION: Fixture = {
  id: 'case-1-cancellation-only',
  title: '1 · "Please unsubscribe me." → cancellation_only',
  group: 'case',
  customer: tomWorld.customer,
  subject: 'Unsubscribe',
  messages: [{ direction: 'in', text: 'Please unsubscribe me.', at: daysAgo(0, '07:30:00') }],
  trigger: 'new_ticket',
  tools: tomWorld.tools,
  scripted: {
    research: [],
    proposal: {
      case: 'cancellation_only',
      confidence: 0.97,
      risk: risk(),
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine: 'Cancel at period end, store the reason, send reply.',
      research: [
        {
          text: 'Active Pro Monthly subscription since February 3, 2026, renews October 14, 2026.',
          sources: [src('stripe', 'Stripe · sub_1PzT8c', 'sub_1PzT8c')],
        },
        {
          text: 'Eight payments of $7.99, no failed payments, refunds or disputes.',
          sources: [src('stripe', 'Stripe · cus_TBecker0203', 'cus_TBecker0203')],
        },
        {
          text: 'Two tracked profiles (@berlin.eats, @tb.runs) stay available until the period ends.',
          sources: [src('supabase', 'Supabase · tracked_profiles', 'tracked_profiles')],
        },
        {
          text: 'No reason given. Stored as "Not stated".',
          sources: [src('email', 'Email history · this thread')],
        },
      ],
      actions: [
        {
          type: 'cancel_at_period_end',
          params: { stripeSubscriptionId: 'sub_1PzT8c', accessUntil: '2026-10-14' },
          reason: because('customer asked to unsubscribe'),
        },
        {
          type: 'store_cancellation_reason',
          params: {
            stripeCustomerId: 'cus_TBecker0203',
            stripeSubscriptionId: 'sub_1PzT8c',
            feedback: 'other',
            comment: 'Not stated',
          },
          reason: because('every cancellation is logged'),
        },
        {
          type: 'send_reply',
          params: { to: 'tom.becker@web.de' },
          reason: because('confirms the end date and asks for the reason'),
        },
      ],
      reply: {
        template: 'Cancellation only',
        templateNotionPageId: TPL.cancellation_only,
        to: 'tom.becker@web.de',
        subject: 'Re: Unsubscribe',
        body: "Hi Tom, thanks for reaching out!\n\nI've cancelled your subscription, so you won't be charged again. You keep full access to all Pro features until October 14, 2026.\n\nIf you don't mind me asking, what made you decide to cancel? I read every answer, and it helps us decide what to improve next.\n\nThanks for giving InstaRadar a try, you're always welcome back!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.cancellation_only, title: 'Cancellation only' },
      ],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['cancellation_only'],
    risk: 'none',
    actions: ['cancel_at_period_end', 'store_cancellation_reason', 'send_reply'],
    stage: 1,
    confirmationNeeded: false,
    replyContains: ['October 14, 2026'],
  },
}

// ---------------------------------------------------------------- 2 · refund within 30 days (two stages)

const marcoWorld = marco()
const marcoStage1: ProposalInput = {
  case: 'refund_request',
  confidence: 0.96,
  risk: risk(),
  customerConfirmationNeeded: true,
  stage: 1,
  summaryLine: 'Ask Marco to confirm, then refund $13.07 and cancel immediately.',
  research: [
    {
      text: 'Paid $13.07 on September 15, 2026 for Pro Monthly (incl. VAT), 12 days ago and inside the 30-day window.',
      sources: [src('stripe', 'Stripe · pi_3QfA7x', 'pi_3QfA7x')],
    },
    {
      text: 'No previous refunds on this customer.',
      sources: [src('stripe', 'Stripe · cus_MBianchi8820', 'cus_MBianchi8820')],
    },
    {
      text: 'A refund closes the account and deletes 4 tracked profiles and their history, so Marco must confirm first.',
      sources: [src('supabase', 'Supabase · tracked_profiles', 'tracked_profiles')],
    },
  ],
  actions: [
    {
      type: 'refund_latest_payment',
      params: {
        stripePaymentIntentId: 'pi_3QfA7x',
        amountCents: 1307,
        currency: 'usd',
        paymentAmountCents: 1307,
        paymentDate: '2026-09-15',
        cardLabel: 'Mastercard ··8820',
      },
      reason: because('refund requested within 30 days'),
      stage: 'after_confirmation',
    },
    {
      type: 'cancel_immediately',
      params: { stripeSubscriptionId: 'sub_1QfA7y', profilesAffected: 4 },
      reason: because('a refund means immediate cancellation'),
      stage: 'after_confirmation',
    },
    {
      type: 'send_reply',
      params: { to: 'marco.bianchi@libero.it' },
      reason: because('explains data deletion and asks for a confirmation'),
    },
  ],
  reply: {
    template: 'Refund request (latest payment)',
    templateNotionPageId: TPL.refund_request,
    to: 'marco.bianchi@libero.it',
    subject: 'Re: Refund request',
    body: "Hi Marco, thanks for reaching out!\n\nI'd be happy to refund your latest payment of $13.07 from September 15. One important note first: a refund cancels your subscription immediately, and your tracking history for your 4 profiles (@marcobianchi, @trattoria.nonna, @mb.photo and @fc.lecco) is deleted right away. This can't be undone.\n\nJust reply \"Yes, refund\" to confirm and I'll process it straight away. The money then shows up on your statement within 5 to 10 business days, depending on your bank.\n\nIf you don't mind me asking, what made you decide to leave? I read every answer, and it genuinely helps us improve.\n\nBest regards,\nAnastasia\nInstaRadar Support",
  },
  knowledgeRefs: [
    {
      kind: 'template',
      notionPageId: TPL.refund_request,
      title: 'Refund request (latest payment)',
    },
  ],
  noKnowledgeFound: false,
}

export const CASE_2_REFUND: Fixture = {
  id: 'case-2-refund-two-stage',
  title: '2 · refund within 30 days → refund_request, stage 1 then stage 2 after "Yes, refund"',
  group: 'case',
  customer: marcoWorld.customer,
  subject: 'Refund request',
  messages: [
    {
      direction: 'in',
      text: "I'd like to cancel and get a refund. I intended to cancel after the free trial but forgot before the billing date, and I haven't used the Pro features since being billed.",
      at: daysAgo(0, '06:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: marcoWorld.tools,
  scripted: { research: [], proposal: marcoStage1 },
  expect: {
    cases: ['refund_request'],
    risk: 'none',
    actions: ['refund_latest_payment', 'cancel_immediately', 'send_reply'],
    stage: 1,
    confirmationNeeded: true,
    afterConfirmation: ['refund_latest_payment', 'cancel_immediately'],
    replyContains: ['13.07'],
  },
  followUp: {
    customerReply: 'Yes, refund',
    scripted: {
      research: [],
      proposal: {
        ...marcoStage1,
        confidence: 0.98,
        customerConfirmationNeeded: false,
        stage: 2,
        summaryLine: 'Refund $13.07 and cancel immediately, then send confirmation.',
        research: [
          {
            text: 'Marco replied "Yes, refund" to our confirmation request.',
            sources: [src('email', 'Email history · this thread')],
          },
          {
            text: 'Payment of $13.07 on September 15 is still refundable. No previous refunds.',
            sources: [src('stripe', 'Stripe · pi_3QfA7x', 'pi_3QfA7x')],
          },
        ],
        actions: [
          {
            type: 'refund_latest_payment',
            params: {
              stripePaymentIntentId: 'pi_3QfA7x',
              amountCents: 1307,
              currency: 'usd',
              paymentAmountCents: 1307,
              paymentDate: '2026-09-15',
              cardLabel: 'Mastercard ··8820',
            },
            reason: because('customer confirmed the refund'),
            stage: 'now',
          },
          {
            type: 'cancel_immediately',
            params: { stripeSubscriptionId: 'sub_1QfA7y', profilesAffected: 4 },
            reason: because('required with a refund'),
            stage: 'now',
          },
          {
            type: 'send_reply',
            params: { to: 'marco.bianchi@libero.it' },
            reason: because('confirms refund and closure'),
          },
        ],
        reply: {
          ...marcoStage1.reply!,
          body: "Hi Marco,\n\nDone. I've refunded $13.07 to your Mastercard ending in 8820 and closed your account. The refund usually appears on your statement within 5 to 10 business days.\n\nThanks for giving InstaRadar a try, and take care.\n\nBest regards,\nAnastasia\nInstaRadar Support",
        },
      },
    },
    expect: {
      cases: ['refund_request'],
      risk: 'none',
      actions: ['refund_latest_payment', 'cancel_immediately', 'send_reply'],
      stage: 2,
      confirmationNeeded: false,
      afterConfirmation: [],
      replyContains: ['13.07'],
    },
  },
}

// ---------------------------------------------------------------- 3 · chargeback from a credit union

const rachelWorld = rachel()
export const CASE_3_CHARGEBACK: Fixture = {
  id: 'case-3-chargeback',
  title:
    '3 · credit union disputes 3 charges after cancel + resubscribe → chargeback, high risk, due date, timeline attachment',
  group: 'case',
  customer: { email: 'disputes@pvcu.org', name: 'Pioneer Valley Credit Union' },
  subject: 'Disputed charges · case PV-2026-08812 · member Rachel Kim',
  messages: [
    {
      direction: 'in',
      text: 'To whom it may concern,\n\nOur member Rachel Kim (rachel.kim@gmail.com) has disputed three charges of $7.99 from InstaRadar dated May 4, June 4 and July 4, 2026, stating the subscription was cancelled three weeks before the first charge. Please provide documentation supporting these charges within 10 days, or refund them to avoid the formal chargeback process.\n\nCase reference: PV-2026-08812\n\nRegards,\nDisputes Team\nPioneer Valley Credit Union',
      at: daysAgo(0, '07:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: rachelWorld.tools,
  extraTickets: [
    {
      email: 'rachel.kim@gmail.com',
      name: 'Rachel Kim',
      subject: 'Story downloads not saving',
      text: 'Hi, when I download a story it does not save to my phone. Can you check?',
      at: '2026-06-12T14:00:00.000Z',
      caseType: 'bug_report',
      replyText: 'Hi Rachel, thanks for reporting this! It is fixed now, could you try again?',
    },
  ],
  scripted: {
    research: [{ name: 'stripe_events', input: { customerId: 'cus_RKim4417', days: 400 } }],
    proposal: {
      case: 'chargeback',
      confidence: 0.97,
      risk: risk(),
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine:
        'Contest the dispute with a formal reply, the payment timeline and proof of use. No refund.',
      research: [
        {
          text: 'Rachel cancelled her first subscription on March 18, then started a new one from the same account on April 4 and upgraded it on April 20.',
          sources: [src('stripe', 'Stripe · 9 events', 'cus_RKim4417')],
          evidence: [
            {
              timestamp: '2026-03-18 09:14',
              event: 'customer.subscription.deleted',
              id: 'sub_1OxK2a',
            },
            {
              timestamp: '2026-04-04 18:52',
              event: 'customer.subscription.created',
              id: 'sub_1P3mQe',
            },
            {
              timestamp: '2026-04-20 11:03',
              event: 'customer.subscription.updated',
              id: 'basic → pro',
            },
            {
              timestamp: '2026-08-29 07:40',
              event: 'charge.dispute.created',
              id: '3 × $7.99',
              tone: 'bad',
            },
          ],
        },
        {
          text: 'All three disputed charges belong to the new subscription, paid with Visa ··4417.',
          sources: [
            src('stripe', 'Stripe · ch_3PqL', 'ch_3PqL'),
            src('stripe', 'ch_3Q1n', 'ch_3Q1n'),
            src('stripe', 'ch_3QbZ', 'ch_3QbZ'),
          ],
        },
        {
          text: 'She signed in 41 times between May and August and kept 2 profiles tracked.',
          sources: [src('supabase', 'Supabase · sessions', 'sessions')],
        },
        {
          text: 'She wrote to support on June 12 about story downloads, during the disputed period.',
          sources: [src('email', 'Email history · Story downloads not saving')],
        },
      ],
      conclusion:
        'The charges are valid. Rachel resubscribed herself and used the product while being billed.',
      actions: [
        {
          type: 'send_reply',
          params: { to: 'disputes@pvcu.org', includeAttachments: true },
          reason: because('the bank requests documentation within 10 days'),
        },
      ],
      reply: {
        template: 'Chargeback / bank dispute',
        templateNotionPageId: TPL.chargeback,
        to: 'disputes@pvcu.org',
        subject: 'Re: Disputed charges · case PV-2026-08812 · member Rachel Kim',
        body: 'Good afternoon,\n\nThank you for reaching out before a formal dispute. I have reviewed the account for case PV-2026-08812, and the three charges of $7.99 on May 4, June 4 and July 4, 2026 are valid charges for an active subscription Ms. Kim started herself.\n\nThe account activity (timeline attached) shows:\n- March 18, 2026: first subscription cancelled by the customer\n- April 4, 2026: new subscription started from the same account, upgraded on April 20\n- May 4, June 4 and July 4, 2026: the disputed monthly charges of $7.99\n- August 2, 2026: subscription cancelled again\n\nThe customer also signed in 41 times during this period and contacted our support team on June 12, which confirms active use. The subscription is now cancelled, so no further charges will occur.\n\nFor these reasons, we are unable to issue a refund. I am glad to provide any further documentation you need.\n\nBest regards,\nAnastasia\nCustomer Care, InstaRadar',
      },
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.chargeback, title: 'Chargeback / bank dispute' },
      ],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['chargeback'],
    risk: 'high',
    actions: ['send_reply'],
    actionsMustExclude: ['refund_latest_payment'],
    stage: 1,
    confirmationNeeded: false,
    dueDate: true,
    dueDateIs: '2026-10-07',
    attachment: true,
  },
}

// ---------------------------------------------------------------- 4 · bug report, existing Linear issue

const priyaWorld = priya()
export const CASE_4_BUG: Fixture = {
  id: 'case-4-bug-report',
  title:
    '4 · false "post deleted" alerts → bug_report linking INS-198, release notice required for the reply',
  group: 'case',
  customer: priyaWorld.customer,
  subject: 'False post deleted alerts',
  messages: [
    {
      direction: 'in',
      text: 'I keep getting post deleted alerts but nothing is deleted. It happened 6 times this week for @studio.kolo.',
      at: daysAgo(0, '05:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: priyaWorld.tools,
  scripted: {
    research: [
      { name: 'vercel_logs', input: { handle: 'studio.kolo', sinceDays: 14, level: 'warning' } },
      { name: 'linear_search', input: { query: 'post deleted alerts 404' } },
    ],
    proposal: {
      case: 'bug_report',
      confidence: 0.95,
      risk: risk(),
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine: "Link to INS-198, store Priya's email for the fix, send reply.",
      research: [
        {
          text: '14 warnings since September 20 where a media 404 from Instagram was treated as a deletion for @studio.kolo, plus 3 exhausted retries.',
          sources: [src('vercel', 'Vercel · scan-worker', 'scan-worker')],
          logLines: [
            'scan-worker WARN media 404 for @studio.kolo/3199004 → emitting post.deleted',
            'scan-worker ERROR retry exhausted for media 3199004',
          ],
        },
        {
          text: '6 post_deleted alerts for @studio.kolo in the last week match her report.',
          sources: [src('supabase', 'Supabase · alerts', 'alerts')],
        },
        {
          text: 'INS-198 already covers this bug (In Progress), so it gets linked instead of a duplicate.',
          sources: [src('linear', 'Linear · INS-198', 'INS-198')],
        },
        {
          text: 'Business Yearly customer since November 2024, a long-term account.',
          sources: [src('stripe', 'Stripe · sub_1PNairY', 'sub_1PNairY')],
        },
      ],
      actions: [
        {
          type: 'create_linear_ticket',
          params: {
            title: "False 'post deleted' alerts when Instagram CDN returns 404",
            description:
              'Customer report from priya.nair@gmail.com: 6 false alerts this week for @studio.kolo. 14 media 404 warnings in scan-worker since Sep 20.',
            label: 'Bug',
            existingIssueIdentifier: 'INS-198',
            customerEmail: 'priya.nair@gmail.com',
          },
          reason: because('the bug is already tracked as INS-198, add her report'),
        },
        {
          type: 'store_release_notification_email',
          params: { linearIssueIdentifier: 'INS-198', email: 'priya.nair@gmail.com' },
          reason: because('the reply promises a notice when the fix is live'),
          requiredForReply: true,
        },
        {
          type: 'send_reply',
          params: { to: 'priya.nair@gmail.com' },
          reason: because('explains the bug and what is still accurate'),
        },
      ],
      reply: {
        template: 'Bug report',
        templateNotionPageId: TPL.bug_report,
        to: 'priya.nair@gmail.com',
        subject: 'Re: False post deleted alerts',
        body: "Hi Priya, thanks for reporting this!\n\nI looked into your account and our logs, and you're right: this is a bug on our side. A temporary error from Instagram is read as a deleted post, so nothing was actually deleted from @studio.kolo. I'm sorry for the confusion it caused.\n\nGood to know: this only affects the deletion alerts. Your follower list and activity timeline for @studio.kolo, @kolo.ceramics and @priya.makes are still 100% accurate.\n\nI've passed it to our engineering team with your details, and I'll email you personally as soon as the fix is live. Thanks for helping us make InstaRadar better!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [{ kind: 'template', notionPageId: TPL.bug_report, title: 'Bug report' }],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['bug_report'],
    // Long-term customer with an issue: the policy raises the risk.
    risk: 'high',
    actions: ['create_linear_ticket', 'store_release_notification_email', 'send_reply'],
    stage: 1,
    confirmationNeeded: false,
    requiredForReply: ['store_release_notification_email'],
    linkedIssue: 'INS-198',
  },
}

// ---------------------------------------------------------------- 5 · feature request, new Linear issue

const liamWorld = liam()
export const CASE_5_FEATURE: Fixture = {
  id: 'case-5-feature-request',
  title:
    '5 · date and time in file names → feature_request, new Linear ticket, release notice required',
  group: 'case',
  customer: liamWorld.customer,
  subject: 'Feature idea: date in file names',
  messages: [
    {
      direction: 'in',
      text: 'Could downloaded files include the date and time in the file name? Right now everything is media.mp4.',
      at: daysAgo(0, '08:10:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: liamWorld.tools,
  scripted: {
    research: [{ name: 'linear_search', input: { query: 'date time file name download' } }],
    proposal: {
      case: 'feature_request',
      confidence: 0.96,
      risk: risk(),
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine: "Create a Linear ticket, store Liam's email, send reply.",
      research: [
        {
          text: 'No existing Linear issue about file names of downloads, so a new Feature issue is created.',
          sources: [src('linear', 'Linear · team InstaRadar')],
        },
        {
          text: 'Pro Monthly customer since June 10, 2026, active and tracking @chen.captures.',
          sources: [
            src('stripe', 'Stripe · sub_1LChen', 'sub_1LChen'),
            src('supabase', 'Supabase · tracked_profiles', 'tracked_profiles'),
          ],
        },
        { text: 'No previous tickets.', sources: [src('email', 'Email history')] },
      ],
      actions: [
        {
          type: 'create_linear_ticket',
          params: {
            title: 'Date and time in downloaded file names',
            description:
              'Feature request from liam.chen@icloud.com: downloaded media is named media.mp4 / thumbnail.jpg; add date and time to the file name. Notify the customer on release.',
            label: 'Feature',
            customerEmail: 'liam.chen@icloud.com',
          },
          reason: because('feature request'),
        },
        {
          type: 'store_release_notification_email',
          params: { fromActionPosition: 0, email: 'liam.chen@icloud.com' },
          reason: because('the reply promises a release notice'),
          requiredForReply: true,
        },
        {
          type: 'send_reply',
          params: { to: 'liam.chen@icloud.com' },
          reason: because('thanks him and confirms the roadmap entry'),
        },
      ],
      reply: {
        template: 'Feature request / feedback',
        templateNotionPageId: TPL.feature_request,
        to: 'liam.chen@icloud.com',
        subject: 'Re: Feature idea: date in file names',
        body: "Hi Liam, thanks so much for the suggestion!\n\nAdding the date and time to downloaded file names is a great idea. I've added it to our roadmap with your email attached.\n\nI'll let you know personally as soon as it's live. And if anything else comes to mind, just reply to this email, I read every idea!\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [
        {
          kind: 'template',
          notionPageId: TPL.feature_request,
          title: 'Feature request / feedback',
        },
      ],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['feature_request'],
    risk: 'none',
    actions: ['create_linear_ticket', 'store_release_notification_email', 'send_reply'],
    stage: 1,
    confirmationNeeded: false,
    requiredForReply: ['store_release_notification_email'],
  },
}

// ---------------------------------------------------------------- 6 · safety / removal

const saraWorld = sara()
export const CASE_6_SAFETY: Fixture = {
  id: 'case-6-safety-removal',
  title:
    '6 · "Remove my profile, I received threats." → safety_removal, risk safety, remove from tracking',
  group: 'case',
  customer: saraWorld.customer,
  subject: 'Remove my profile',
  messages: [
    {
      direction: 'in',
      text: 'Remove my profile @sara.lindqvist from your website, I received threats.',
      at: daysAgo(0, '04:20:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: saraWorld.tools,
  scripted: {
    research: [{ name: 'instaradar_profile', input: { handle: 'sara.lindqvist' } }],
    proposal: {
      case: 'safety_removal',
      confidence: 0.99,
      risk: {
        level: 'safety',
        reason: 'Safety / removal request: the person received threats.',
        dueDate: null,
      },
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine: 'Remove @sara.lindqvist from tracking and viewing, send reply.',
      research: [
        {
          text: '@sara.lindqvist is tracked by 3 InstaRadar users and not blocked yet.',
          sources: [src('supabase', 'Supabase · tracked_profiles', 'tracked_profiles')],
        },
        {
          text: 'The sender is not an InstaRadar customer (no Stripe or account record), which is expected for a removal request.',
          sources: [src('stripe', 'Stripe'), src('supabase', 'Supabase · profiles')],
        },
        {
          text: 'Safety requests are handled immediately, without asking for proof.',
          sources: [src('notion', 'Notion · Protocol', '3e8c931f6ae58012a0a7ec9a1adb4259')],
        },
      ],
      actions: [
        {
          type: 'remove_from_tracking',
          params: {
            instagramHandle: 'sara.lindqvist',
            reason: 'Safety: the person received threats and asked for removal',
          },
          reason: because('safety comes first, remove immediately'),
        },
        {
          type: 'send_reply',
          params: { to: 'sara.lindqvist@gmail.com' },
          reason: because('confirms the removal without asking for anything'),
        },
      ],
      reply: {
        template: 'Safety / removal request',
        templateNotionPageId: TPL.safety_removal,
        to: 'sara.lindqvist@gmail.com',
        subject: 'Re: Remove my profile',
        body: "Hi, thank you for reaching out, and I'm truly sorry you're going through this. Your safety comes first.\n\nI've removed your profile @sara.lindqvist from InstaRadar. It can no longer be tracked, searched or viewed anonymously through our platform, and I've deleted the data we had stored about it. You don't need to explain anything further.\n\nIf you notice anything that suggests otherwise, reply to this email and I'll look into it immediately. Please take care of yourself.\n\nBest wishes,\nAnastasia\nCustomer Care, InstaRadar",
      },
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.safety_removal, title: 'Safety / removal request' },
      ],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['safety_removal'],
    risk: 'safety',
    actions: ['remove_from_tracking', 'send_reply'],
    stage: 1,
    confirmationNeeded: false,
    replyContains: ['sara.lindqvist'],
  },
}

// ---------------------------------------------------------------- 7 · data accuracy, knowledge based

const jonasWorld = jonas()
export const CASE_7_DATA_ACCURACY: Fixture = {
  id: 'case-7-data-accuracy',
  title:
    '7 · "The follower count keeps going up but nothing new shows up." → data_accuracy, reply only, knowledge based',
  group: 'case',
  customer: jonasWorld.customer,
  subject: 'Follower count does not add up',
  messages: [
    {
      direction: 'in',
      text: "The follower count keeps going up but nothing new shows up. I don't trust that it's accurate.",
      at: daysAgo(1, '11:00:00'),
    },
  ],
  trigger: 'new_ticket',
  tools: jonasWorld.tools,
  knowledgeBase: [KB_FOLLOWER_COUNT, KB_DRAFT_ENTRY],
  scripted: {
    research: [
      { name: 'notion_page', input: { pageId: KB_PAGES.followerCount } },
      {
        name: 'instaradar_select',
        input: {
          sql: "select * from public.follower_snapshots where user_id = 'usr_jweber_5a2c' order by created_at desc",
          purpose: 'Compare new followers with visible followers',
        },
      },
    ],
    proposal: {
      case: 'data_accuracy',
      confidence: 0.91,
      risk: risk(),
      customerConfirmationNeeded: false,
      stage: 1,
      summaryLine: 'Explain the follower count lag with the knowledge base entry. Reply only.',
      research: [
        {
          text: '@weber.woodworks gained 38 followers this week; 31 are private accounts that never appear in the visible list.',
          sources: [src('supabase', 'Supabase · follower_snapshots', 'follower_snapshots')],
        },
        {
          text: 'Scans ran daily without errors.',
          sources: [
            src('supabase', 'Supabase · scans', 'scans'),
            src('vercel', 'Vercel · scan-worker', 'scan-worker'),
          ],
        },
        {
          text: 'Matching knowledge base entry: follower count fluctuation and private followers.',
          sources: [
            src('kb', 'Knowledge base · Follower count fluctuation', KB_PAGES.followerCount),
          ],
        },
      ],
      actions: [
        {
          type: 'send_reply',
          params: { to: 'jonas.weber@gmx.net' },
          reason: because('the answer is in the knowledge base, nothing to change on the account'),
        },
      ],
      reply: {
        template: 'Data accuracy concern',
        templateNotionPageId: TPL.data_accuracy,
        to: 'jonas.weber@gmx.net',
        subject: 'Re: Follower count does not add up',
        body: "Hi Jonas, thanks for reaching out, I'd like to get to the bottom of this!\n\nI looked at @weber.woodworks: the count went up by 38 this week, and 31 of those new followers are private accounts. Instagram includes them in the total, but they never appear in the visible follower list, so the count moves while the list looks unchanged. Your list is accurate, it just cannot show private accounts.\n\nIf you saw something else that looked off, tell me where (the count at the top, the follower list, or an event in your timeline) and I'll check it right away.\n\nBest regards,\nAnastasia\nInstaRadar Support",
      },
      knowledgeRefs: [
        { kind: 'template', notionPageId: TPL.data_accuracy, title: 'Data accuracy concern' },
        { kind: 'kb', notionPageId: KB_PAGES.followerCount, title: 'Follower count fluctuation' },
      ],
      noKnowledgeFound: false,
    },
  },
  expect: {
    cases: ['data_accuracy', 'product_question'],
    risk: 'none',
    actions: ['send_reply'],
    stage: 1,
    confirmationNeeded: false,
    noKnowledgeFound: false,
  },
}

export const CASE_FIXTURES: Fixture[] = [
  CASE_1_CANCELLATION,
  CASE_2_REFUND,
  CASE_3_CHARGEBACK,
  CASE_4_BUG,
  CASE_5_FEATURE,
  CASE_6_SAFETY,
  CASE_7_DATA_ACCURACY,
]
