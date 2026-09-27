/** Test helpers: an ActionContext wired to the in-memory fakes. */
import type { ReplyDraft } from '../../shared/proposal'
import type { MailService, SentMail } from '../../shared/services'
import { createFakeClients } from '../../server/executor/clients'
import { createFakeStore, type FakeStore } from '../../server/executor/store'
import type {
  ActionContext,
  ProposalRecord,
  SettingsRecord,
  TicketRecord,
} from '../../server/executor/types'

export const TICKET_ID = '11111111-1111-4111-8111-111111111111'

export function makeTicket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: TICKET_ID,
    appId: 'app-1',
    displayNumber: 4824,
    customerEmail: 'tom.becker@web.de',
    customerName: 'Tom Becker',
    subject: 'Unsubscribe',
    status: 'executing',
    resolution: null,
    caseType: 'cancellation_only',
    riskLevel: 'none',
    stage: 1,
    waitingFor: null,
    snoozedUntil: null,
    instaradarUserId: 'usr_tbecker_71c0',
    stripeCustomerId: 'cus_TBecker0203',
    createdAt: new Date('2026-09-27T08:00:00Z').toISOString(),
    ...overrides,
  }
}

export const REPLY: ReplyDraft = {
  template: 'Cancellation only',
  templateNotionPageId: null,
  to: 'tom.becker@web.de',
  subject: 'Re: Unsubscribe',
  body: "Hi Tom, thanks for reaching out!\n\nI've cancelled your subscription.\n\nBest regards,\nAnastasia",
  attachments: [],
}

export function makeProposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: 'prop-1',
    ticketId: TICKET_ID,
    version: 1,
    caseType: 'cancellation_only',
    stage: 1,
    customerConfirmationNeeded: false,
    policyWarnings: [],
    riskLevel: 'none',
    replyDraft: REPLY,
    status: 'active',
    createdAt: new Date('2026-09-27T08:00:21Z').toISOString(),
    actions: [
      {
        id: 'pa-0',
        position: 0,
        type: 'cancel_at_period_end',
        params: { stripeSubscriptionId: 'sub_1PzT8c', accessUntil: '2026-10-14' },
        reason: 'Because: customer asked to unsubscribe',
        stage: 'now',
        requiredForReply: false,
        enabled: true,
      },
      {
        id: 'pa-1',
        position: 1,
        type: 'store_cancellation_reason',
        params: {
          stripeCustomerId: 'cus_TBecker0203',
          stripeSubscriptionId: 'sub_1PzT8c',
          feedback: 'other',
          comment: 'Not stated',
        },
        reason: 'Because: every cancellation is logged',
        stage: 'now',
        requiredForReply: false,
        enabled: true,
      },
      {
        id: 'pa-2',
        position: 2,
        type: 'send_reply',
        params: { to: 'tom.becker@web.de' },
        reason: 'Because: confirms the end date',
        stage: 'now',
        requiredForReply: false,
        enabled: true,
      },
    ],
    ...overrides,
  }
}

export const SETTINGS: SettingsRecord = {
  appId: 'app-1',
  globalPause: false,
  undoWindowMinutes: 10,
  timezone: 'Europe/Berlin',
  refundDailyLimitCount: 3,
  refundDailyLimitAmountCents: 10_000,
}

export interface RecordingMail extends MailService {
  sent: {
    ticketId: string
    to: string
    subject: string
    sentBy?: string
    idempotencyKey?: string
  }[]
  failNext: Error | null
}

export function createRecordingMail(): RecordingMail {
  const sent: RecordingMail['sent'] = []
  const mail: RecordingMail = {
    sent,
    failNext: null,
    async sendReply(ticketId, draft, opts): Promise<SentMail> {
      if (mail.failNext) {
        const err = mail.failNext
        mail.failNext = null
        throw err
      }
      sent.push({
        ticketId,
        to: draft.to,
        subject: draft.subject,
        sentBy: opts?.sentBy,
        idempotencyKey: opts?.idempotencyKey,
      })
      const n = sent.length
      return { messageId: `msg_${n}`, providerMessageId: `prov_${n}`, rfcMessageId: `<m${n}@test>` }
    },
    async sendSystemEmail() {},
  }
  return mail
}

export function makeCtx(overrides: Partial<ActionContext> = {}) {
  const fakes = createFakeClients()
  const store: FakeStore = createFakeStore()
  const mail = createRecordingMail()
  const ticket = overrides.ticket ?? makeTicket()
  const ctx: ActionContext = {
    ticket,
    proposal: makeProposal(),
    executedBy: 'you',
    idempotencyKey: `${ticket.id}:v1:p0`,
    attempt: 1,
    clients: fakes.clients,
    store,
    settings: SETTINGS,
    mail,
    now: () => new Date('2026-09-27T10:00:00Z'),
    priorResults: new Map(),
    customerConfirmed: false,
    replyDraft: REPLY,
    scheduleReplyFor: null,
    ...overrides,
  }
  return { ctx, fakes, store, mail }
}
