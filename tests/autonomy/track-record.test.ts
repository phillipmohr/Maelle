import { describe, expect, it } from 'vitest'
import {
  AutonomyUpdateSchema,
  buildTrackRecord,
  decisionTick,
  describeSettingsChange,
  formatSettingValue,
  isCollapsedCase,
  recommendationFor,
  trackRecordLine,
} from '../../shared/autonomy'
import type { DecisionKind } from '../../shared/api'
import type { CaseType } from '../../shared/case-types'
import { buildSeed } from '../../shared/seed/data'
import { seedAutonomyResponse } from '../../server/autonomy/seed'

const now = new Date('2026-09-27T09:50:00Z')

/** Decisions that leave `unchanged` unchanged ticks, `edited` edited ticks and `rejected` rejected ticks. */
function decisions(unchanged: number, edited: number, rejected: number) {
  const list: { decision: DecisionKind; decidedAt: string }[] = []
  let i = 0
  const push = (d: DecisionKind) =>
    list.push({
      decision: d,
      decidedAt: new Date(now.getTime() - (200 - i++) * 3_600_000).toISOString(),
    })
  for (let k = 0; k < unchanged; k++) push(k % 2 ? 'approved' : 'auto')
  for (let k = 0; k < edited; k++) push('approved_with_edits')
  for (let k = 0; k < rejected; k++) push(k % 2 ? 'rejected' : 'handled_manually')
  return list
}

describe('recommendation rules (design data of screen 1h)', () => {
  const rec = (
    caseType: CaseType,
    t: [number, number, number],
    mode: 'always_ask' | 'auto' = 'always_ask',
  ) =>
    buildTrackRecord(
      {
        caseType,
        decisions: decisions(...t),
        mode,
        autoSince: mode === 'auto' ? '2026-09-12T09:00:00Z' : null,
        undos: 0,
      },
      now,
    )

  it('matches every row of the design', () => {
    expect(rec('cancellation_only', [28, 2, 0]).recommendation).toBe('Ready for Auto')
    expect(rec('cancellation_only', [28, 2, 0]).recommendationKind).toBe('ready')
    expect(rec('feature_request', [17, 0, 0], 'auto').recommendation).toBe(
      'On Auto since Sep 12 · 0 undos',
    )
    expect(rec('data_accuracy', [10, 1, 0]).recommendation).toBe('Collecting · 4 more tickets')
    expect(rec('product_question', [7, 2, 0]).recommendation).toBe('Collecting · 6 more tickets')
    expect(rec('bug_report', [8, 3, 1]).recommendation).toBe('Keep asking · 1 rejected')
    expect(rec('refund_request', [6, 2, 0]).recommendation).toBe(
      'Keep asking · irreversible actions',
    )
    expect(rec('chargeback', [2, 0, 0]).recommendation).toBe('Collecting · 13 more tickets')
  })

  it('needs 90% unchanged once 15 tickets are in', () => {
    expect(rec('product_question', [13, 2, 0]).recommendation).toBe('Keep asking · too many edits')
    expect(rec('product_question', [14, 1, 0]).recommendation).toBe('Ready for Auto')
    expect(rec('product_question', [14, 0, 0]).recommendation).toBe('Collecting · 1 more ticket')
  })

  it('counts undos and pluralises', () => {
    expect(
      recommendationFor(
        {
          caseType: 'feature_request',
          total: 20,
          unchanged: 20,
          rejected: 0,
          mode: 'auto',
          autoSince: '2026-09-12T09:00:00Z',
          undos: 1,
        },
        now,
      ).text,
    ).toBe('On Auto since Sep 12 · 1 undo')
  })
})

describe('buildTrackRecord', () => {
  it('keeps the newest 30 decisions, newest last, and ignores snoozed and marked_done', () => {
    const list = decisions(35, 0, 0)
    list.push({ decision: 'snoozed', decidedAt: now.toISOString() })
    list.push({ decision: 'marked_done', decidedAt: now.toISOString() })
    list.unshift({ decision: 'rejected', decidedAt: '2020-01-01T00:00:00Z' }) // too old for the window
    const r = buildTrackRecord({ caseType: 'product_question', decisions: list }, now)
    expect(r.total).toBe(30)
    expect(r.rejected).toBe(0)
    expect(r.ticks).toHaveLength(30)
    expect(trackRecordLine(r)).toBe('30 tickets · 30 unchanged · 0 edited · 0 rejected')
  })

  it('maps decisions to ticks', () => {
    expect(decisionTick('approved')).toBe('unchanged')
    expect(decisionTick('auto')).toBe('unchanged')
    expect(decisionTick('approved_with_edits')).toBe('edited')
    expect(decisionTick('rejected')).toBe('rejected')
    expect(decisionTick('handled_manually')).toBe('rejected')
    expect(decisionTick('snoozed')).toBeNull()
    expect(decisionTick('marked_done')).toBeNull()
  })

  it('collapses rows with fewer than 5 tickets unless they are on Auto', () => {
    expect(isCollapsedCase({ total: 4, mode: 'always_ask' })).toBe(true)
    expect(isCollapsedCase({ total: 5, mode: 'always_ask' })).toBe(false)
    expect(isCollapsedCase({ total: 0, mode: 'auto' })).toBe(false)
  })
})

describe('seed-backed autonomy response', () => {
  const res = seedAutonomyResponse(buildSeed(now, 'test@maelle.local'), now)

  it('has every template case type, feature requests on Auto', () => {
    expect(res.cases).toHaveLength(17)
    const fr = res.cases.find((c) => c.caseType === 'feature_request')!
    expect(fr.mode).toBe('auto')
    expect(fr.recommendation).toBe('On Auto since Sep 12 · 0 undos')
    expect(fr.total).toBe(3)
    expect(fr.unchanged).toBe(3)
    expect(res.onAutoCount).toBe(1)
    expect(res.alwaysAskCount).toBe(16)
  })

  it('matches the seed decisions per case type', () => {
    const byCase = Object.fromEntries(res.cases.map((c) => [c.caseType, c]))
    expect(byCase.second_refund_request!.rejected).toBe(1)
    expect(byCase.charged_after_cancellation!.edited).toBe(1)
    expect(byCase.outage_access!.rejected).toBe(1)
    expect(byCase.refund_request!.total).toBe(2)
    expect(byCase.billing_question!.total).toBe(0) // only snoozed
    expect(byCase.refund_request!.recommendation).toBe('Keep asking · irreversible actions')
  })

  it('locks the three irreversible actions by default', () => {
    const locked = res.locks
      .filter((l) => l.locked)
      .map((l) => l.type)
      .sort()
    expect(locked).toEqual(['cancel_immediately', 'delete_account', 'refund_latest_payment'])
    expect(res.locks.some((l) => l.type === 'send_reply')).toBe(false)
    expect(res.settings.undoWindowMinutes).toBe(10)
    expect(res.settings.digestTime).toBe('08:00')
  })
})

describe('audit summaries and validation', () => {
  it('describes changes in one line without em dashes', () => {
    const lines = [
      describeSettingsChange('mode', 'cancellation_only', 'always_ask', 'auto'),
      describeSettingsChange('lock', 'refund_latest_payment', true, false),
      describeSettingsChange('setting', 'undoWindowMinutes', 10, 15),
      describeSettingsChange('setting', 'globalPause', false, true),
      describeSettingsChange('setting', 'refundDailyLimitAmountCents', 10000, 25000),
      describeSettingsChange('setting', 'notifyEmail', null, 'p@example.com'),
    ]
    expect(lines).toEqual([
      'Cancellation only: Always ask → Auto',
      'Refund latest payment: unlocked for Auto',
      'Undo window: 10 min → 15 min',
      'Pause all: on',
      'Refund amount per day: $100.00 → $250.00',
      'Notify email: not set → p@example.com',
    ])
    for (const l of lines) expect(l).not.toMatch(/[—―]/)
    expect(formatSettingValue('followUpDays', 1)).toBe('1 day')
  })

  it('validates PUT bodies', () => {
    expect(AutonomyUpdateSchema.safeParse({ modes: { cancellation_only: 'auto' } }).success).toBe(
      true,
    )
    expect(AutonomyUpdateSchema.safeParse({ modes: { unclear: 'auto' } }).success).toBe(false)
    expect(AutonomyUpdateSchema.safeParse({ locks: { send_reply: true } }).success).toBe(false)
    expect(
      AutonomyUpdateSchema.safeParse({ locks: { refund_latest_payment: false } }).success,
    ).toBe(true)
    expect(AutonomyUpdateSchema.safeParse({ settings: { undoWindowMinutes: 7 } }).success).toBe(
      false,
    )
    expect(AutonomyUpdateSchema.safeParse({ settings: { digestTime: '8:00' } }).success).toBe(false)
    expect(
      AutonomyUpdateSchema.safeParse({
        settings: { digestTime: '08:00', timezone: 'Europe/Berlin' },
      }).success,
    ).toBe(true)
    expect(AutonomyUpdateSchema.safeParse({ settings: { timezone: 'Mars/Olympus' } }).success).toBe(
      false,
    )
    expect(AutonomyUpdateSchema.safeParse({}).success).toBe(false)
    expect(AutonomyUpdateSchema.safeParse({ settings: { bogus: 1 } }).success).toBe(false)
  })
})
