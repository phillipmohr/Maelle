import { describe, expect, it } from 'vitest'
import type { MessageRow } from '../../shared/api'
import {
  detectConfirmation,
  isNewConversation,
  stripQuotedReply,
} from '../../server/agent/two-stage'

function msg(
  direction: 'in' | 'out',
  text: string,
  at: string,
  translation: string | null = null,
): MessageRow {
  return {
    id: `${direction}-${at}`,
    ticketId: 't',
    direction,
    fromEmail: direction === 'in' ? 'c@x.io' : 'support@instaradar.app',
    fromName: null,
    toEmails: [],
    subject: null,
    textBody: text,
    htmlBody: null,
    translation,
    attachments: [],
    receivedAt: direction === 'in' ? at : null,
    sentAt: direction === 'out' ? at : null,
    sentBy: direction === 'out' ? 'you' : null,
    createdAt: at,
  }
}

const ask = msg('out', 'Just reply "Yes, refund" to confirm.', '2026-09-25T10:00:00Z')

describe('confirmation detection', () => {
  it('is none without an exchange', () => {
    expect(detectConfirmation([msg('in', 'Yes please refund me', '2026-09-25T09:00:00Z')])).toBe(
      'none',
    )
    expect(detectConfirmation([])).toBe('none')
  })

  it('detects a plain yes after our question', () => {
    for (const text of [
      'Yes, refund',
      'yes please',
      'Confirmed, go ahead.',
      'Ok do it',
      'Please proceed with the refund',
      'Ja, bitte',
      'Yes, refund please. Thanks.',
    ])
      expect(detectConfirmation([ask, msg('in', text, '2026-09-26T10:00:00Z')]), text).toBe(
        'confirmed',
      )
  })

  it('detects a change of mind', () => {
    for (const text of [
      'Actually I changed my mind, please keep my subscription.',
      "No, don't refund. I want to keep it.",
      'Never mind, leave it as is.',
    ])
      expect(detectConfirmation([ask, msg('in', text, '2026-09-26T10:00:00Z')]), text).toBe(
        'declined',
      )
  })

  it('stays none on ambiguous replies and ignores quoted text', () => {
    expect(
      detectConfirmation([
        ask,
        msg('in', 'What happens to my data exactly?', '2026-09-26T10:00:00Z'),
      ]),
    ).toBe('none')
    expect(
      detectConfirmation([
        ask,
        msg('in', 'Hmm.\n\n> Just reply "Yes, refund" to confirm.', '2026-09-26T10:00:00Z'),
      ]),
    ).toBe('none')
    expect(
      detectConfirmation([ask, msg('in', 'Sí, adelante', '2026-09-26T10:00:00Z', 'Yes, go ahead')]),
    ).toBe('confirmed')
  })

  it('only looks at replies after our latest message', () => {
    const yesBefore = msg('in', 'yes', '2026-09-24T10:00:00Z')
    const question = msg('in', 'Can you explain?', '2026-09-26T10:00:00Z')
    expect(detectConfirmation([yesBefore, ask, question])).toBe('none')
  })
})

describe('reply helpers', () => {
  it('strips quoted replies and signatures', () => {
    expect(
      stripQuotedReply('Yes, refund\n\nOn Thu, Sep 25, 2026 Anastasia wrote:\n> Just reply'),
    ).toBe('Yes, refund')
    expect(stripQuotedReply('Ok\n--\nSent from my phone')).toBe('Ok')
  })
  it('knows a new conversation', () => {
    expect(isNewConversation([msg('in', 'hi', '2026-09-25T10:00:00Z')])).toBe(true)
    expect(isNewConversation([msg('in', 'hi', '2026-09-25T10:00:00Z'), ask])).toBe(false)
  })
})
