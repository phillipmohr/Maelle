import { describe, expect, it } from 'vitest'
import { createNotify } from '../../server/notify'
import { localDateKey, type DigestData } from '../../server/notify/digest'
import { createMemoryNotificationLog } from '../../server/notify/log'
import { renderDigest, renderHighRiskAlert, renderSystemAlert } from '../../server/notify/templates'

const EM_DASH = /[—―]/

const alertPayload = {
  ticketId: 'b8a6e8f0-0000-4000-8000-000000004825',
  displayNumber: 4825,
  customerName: 'Pioneer Valley Credit Union',
  customerEmail: 'disputes@pvcu.org',
  caseType: 'chargeback' as const,
  riskLevel: 'high' as const,
  dueDate: '2026-10-07',
  url: 'https://maelle.example/anastasai/t/4825',
}

const digest: DigestData = {
  since: '2026-09-26T06:00:00Z',
  until: '2026-09-27T06:00:00Z',
  timezone: 'Europe/Berlin',
  siteUrl: 'https://maelle.example',
  autoHandled: [
    {
      displayNumber: 4818,
      customerName: 'Liam Chen',
      customerEmail: 'liam.chen@icloud.com',
      caseType: 'feature_request',
      at: '2026-09-27T05:52:00Z',
      ran: ['create_linear_ticket', 'store_release_notification_email', 'send_reply'],
    },
  ],
  needsDecision: [
    {
      displayNumber: 4825,
      customerName: 'Pioneer Valley Credit Union',
      customerEmail: 'disputes@pvcu.org',
      caseType: 'chargeback',
      at: '2026-09-27T03:00:00Z',
      status: 'needs_decision',
      riskLevel: 'high',
      dueDate: '2026-10-07',
    },
  ],
  waiting: [
    {
      displayNumber: 4801,
      customerName: 'Kate Morgan',
      customerEmail: 'kate.morgan@yahoo.com',
      caseType: 'billing_question',
      at: '2026-09-26T08:00:00Z',
      status: 'snoozed',
      snoozedUntil: '2026-09-28T07:00:00Z',
    },
  ],
  failures: [
    {
      displayNumber: 4820,
      customerName: 'Priya Nair',
      action: 'store_release_notification_email',
      error: 'Supabase: insert into release_notify timed out after 10s · req_8d1e42',
      at: '2026-09-27T05:40:00Z',
    },
  ],
}

function harness(opts: { recipient?: string | null; fail?: boolean } = {}) {
  const sent: { to: string; subject: string; body: string }[] = []
  const log = createMemoryNotificationLog(() => new Date('2026-09-27T06:00:00Z'))
  const notify = createNotify({
    sendSystemEmail: async (to, subject, body) => {
      if (opts.fail) throw new Error('SMTP 451')
      sent.push({ to, subject, body })
    },
    recipient: async () => (opts.recipient === undefined ? 'phillip@example.com' : opts.recipient),
    log,
    digest: async () => digest,
    now: () => new Date('2026-09-27T06:00:00Z'),
    logger: () => {},
  })
  return { notify, sent, log }
}

describe('templates', () => {
  it('renders the high-risk alert with who, case, due date and link', () => {
    const m = renderHighRiskAlert(alertPayload)
    expect(m.subject).toBe(
      '[Maelle] High risk · #4825 Pioneer Valley Credit Union · Chargeback / bank dispute',
    )
    expect(m.body).toContain('Who: Pioneer Valley Credit Union <disputes@pvcu.org>')
    expect(m.body).toContain('Case: Chargeback / bank dispute')
    expect(m.body).toContain('Due: Oct 7')
    expect(m.body).toContain('Open it: https://maelle.example/anastasai/t/4825')
    expect(
      renderHighRiskAlert({ ...alertPayload, riskLevel: 'safety', caseType: 'safety_removal' })
        .subject,
    ).toMatch(/^\[Maelle\] Safety · /)
  })

  it('renders the digest sections', () => {
    const m = renderDigest(digest)
    expect(m.subject).toBe('[Maelle] Daily digest · 1 need a decision · 1 handled automatically')
    expect(m.body).toContain('Handled automatically (1)')
    expect(m.body).toContain(
      '#4818 Liam Chen · Feature request · Create Linear ticket, Store email for release notification, Send reply',
    )
    expect(m.body).toContain(
      '#4825 Pioneer Valley Credit Union · Chargeback / bank dispute · high risk · due Oct 7',
    )
    expect(m.body).toContain('snoozed until')
    expect(m.body).toContain('Failed actions (1)')
    expect(m.body).toContain('Open the inbox: https://maelle.example/anastasai')
    expect(renderDigest({ ...digest, autoHandled: [], failures: [] }).body).toContain(
      'Failed actions (0)\n  none',
    )
  })

  it('never contains an em dash', () => {
    for (const m of [
      renderHighRiskAlert(alertPayload),
      renderDigest(digest),
      renderSystemAlert({ title: 'Mail fetch failing', detail: 'IMAP timeout', source: 'jobs' }),
    ]) {
      expect(m.subject).not.toMatch(EM_DASH)
      expect(m.body).not.toMatch(EM_DASH)
    }
  })
})

describe('notify', () => {
  it('sends the high-risk alert once per ticket', async () => {
    const { notify, sent, log } = harness()
    await notify('high_risk_ticket', alertPayload)
    await notify('high_risk_ticket', alertPayload)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('phillip@example.com')
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]).toMatchObject({
      kind: 'high_risk_ticket',
      status: 'sent',
      dedupeKey: alertPayload.ticketId,
    })
    // another ticket gets its own alert
    await notify('high_risk_ticket', { ...alertPayload, ticketId: 'other', displayNumber: 4826 })
    expect(sent).toHaveLength(2)
  })

  it('sends the digest once per local day and remembers when', async () => {
    const { notify, sent, log } = harness()
    await notify('daily_digest', {})
    await notify('daily_digest', {})
    expect(sent).toHaveLength(1)
    expect(log.entries[0]!.dedupeKey).toBe('digest:2026-09-27')
    expect(await log.lastSentAt('daily_digest')).toBe('2026-09-27T06:00:00.000Z')
  })

  it('always sends system alerts', async () => {
    const { notify, sent } = harness()
    await notify('system_alert', {
      title: 'Dead-letter job',
      detail: 'agent_run failed 5 times',
      source: 'jobs',
    })
    await notify('system_alert', {
      title: 'Dead-letter job',
      detail: 'agent_run failed 5 times',
      source: 'jobs',
    })
    expect(sent).toHaveLength(2)
    expect(sent[0]!.subject).toBe('[Maelle] Alert · Dead-letter job')
  })

  it('records skipped when no recipient is configured, and retries later', async () => {
    const { notify, sent, log } = harness({ recipient: null })
    await notify('high_risk_ticket', alertPayload)
    expect(sent).toHaveLength(0)
    expect(log.entries[0]!.status).toBe('skipped')
    // a skipped entry can be claimed again once a recipient exists
    expect(
      await log.claim({ kind: 'high_risk_ticket', dedupeKey: alertPayload.ticketId }),
    ).not.toBeNull()
  })

  it('records failures and rethrows', async () => {
    const { notify, log } = harness({ fail: true })
    await expect(notify('high_risk_ticket', alertPayload)).rejects.toThrow('SMTP 451')
    expect(log.entries[0]).toMatchObject({ status: 'failed', error: 'SMTP 451' })
  })

  it('computes the local date key in the settings timezone', () => {
    expect(localDateKey(new Date('2026-09-27T23:30:00Z'), 'Europe/Berlin')).toBe('2026-09-28')
    expect(localDateKey(new Date('2026-09-27T23:30:00Z'), 'UTC')).toBe('2026-09-27')
    expect(localDateKey(new Date('2026-09-27T23:30:00Z'), 'Nowhere/Invalid')).toBe('2026-09-27')
  })
})
