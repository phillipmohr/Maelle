import { describe, expect, it } from 'vitest'
import {
  isFreshTimestamp,
  isIssueCompletion,
  matchesTeam,
  signLinearBody,
  verifyLinearSignature,
  type LinearIssuePayload,
} from '../../server/mail/linear-webhook'

const secret = 'lin_wh_secret'
const body = JSON.stringify({ action: 'update', type: 'Issue', data: { id: '1' } })

describe('Linear webhook signature', () => {
  it('accepts the HMAC-SHA256 hex of the raw body and rejects everything else', () => {
    const sig = signLinearBody(body, secret)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyLinearSignature(body, sig, secret)).toBe(true)
    expect(verifyLinearSignature(body, sig.toUpperCase(), secret)).toBe(true)
    expect(verifyLinearSignature(body, sig, 'other')).toBe(false)
    expect(verifyLinearSignature(body + ' ', sig, secret)).toBe(false)
    expect(verifyLinearSignature(body, undefined, secret)).toBe(false)
    expect(verifyLinearSignature(body, 'not-hex', secret)).toBe(false)
    expect(verifyLinearSignature(body, sig, '')).toBe(false)
  })

  it('checks the webhook timestamp within the tolerance', () => {
    const now = new Date('2026-09-27T12:00:00Z')
    expect(isFreshTimestamp(now.getTime() - 30_000, now)).toBe(true)
    expect(isFreshTimestamp(now.getTime() + 60_000, now)).toBe(true)
    expect(isFreshTimestamp(now.getTime() - 10 * 60_000, now)).toBe(false)
    expect(isFreshTimestamp('abc', now)).toBe(false)
  })
})

describe('Linear issue completion', () => {
  const completed: LinearIssuePayload = {
    action: 'update',
    type: 'Issue',
    data: {
      id: 'i1',
      identifier: 'IRDR-12',
      title: 'Fix',
      team: { id: 't1', key: 'IRDR' },
      state: { type: 'completed' },
    },
    updatedFrom: { stateId: 'old' },
  }

  it('detects a move into a completed state', () => {
    expect(isIssueCompletion(completed)).toBe(true)
    expect(isIssueCompletion({ ...completed, updatedFrom: { title: 'x' } })).toBe(false)
    expect(
      isIssueCompletion({ ...completed, data: { ...completed.data, state: { type: 'started' } } }),
    ).toBe(false)
    expect(isIssueCompletion({ ...completed, type: 'Comment' })).toBe(false)
    expect(isIssueCompletion({ ...completed, action: 'create', updatedFrom: undefined })).toBe(true)
    expect(isIssueCompletion({ ...completed, action: 'remove' })).toBe(false)
  })

  it('filters by team id or key, with the identifier prefix as fallback', () => {
    expect(matchesTeam(completed, {})).toBe(true)
    expect(matchesTeam(completed, { teamKey: 'irdr' })).toBe(true)
    expect(matchesTeam(completed, { teamKey: 'INS' })).toBe(false)
    expect(matchesTeam(completed, { teamId: 't1' })).toBe(true)
    expect(matchesTeam(completed, { teamId: 't2', teamKey: 'INS' })).toBe(false)
    expect(
      matchesTeam(
        { ...completed, data: { identifier: 'IRDR-12', state: { type: 'completed' } } },
        { teamKey: 'IRDR' },
      ),
    ).toBe(true)
  })
})
