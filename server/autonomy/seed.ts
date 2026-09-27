/**
 * Seed-backed GET /api/autonomy for the offline dev server (no database). Same rules as the
 * database path, so the two never disagree on a recommendation.
 */
import type { AutonomyResponse, DecisionKind, SettingsRow } from '#shared/api'
import { ACTION_LIST, type ActionType } from '#shared/actions'
import { TEMPLATE_CASE_TYPES, type CaseType } from '#shared/case-types'
import { buildTrackRecord, normalizeDigestTime } from '#shared/autonomy'
import type { SeedBundle } from '#shared/seed/data'
import { sortCases } from './repo'

export function seedSettings(seed: SeedBundle): SettingsRow {
  const s = seed.settings[0]!
  return {
    appId: String(s.app_id),
    globalPause: Boolean(s.global_pause),
    undoWindowMinutes: Number(s.undo_window_minutes) as 5 | 10 | 15,
    digestTime: normalizeDigestTime(String(s.digest_time)),
    timezone: String(s.timezone),
    followUpDays: Number(s.follow_up_days),
    autoCloseDays: Number(s.auto_close_days),
    refundDailyLimitCount: Number(s.refund_daily_limit_count),
    refundDailyLimitAmountCents: Number(s.refund_daily_limit_amount_cents),
    notifyEmail: (s.notify_email as string | null) ?? null,
  }
}

export function seedAutonomyResponse(seed: SeedBundle, now: Date = new Date()): AutonomyResponse {
  const modes = new Map(seed.autonomy_modes.map((m) => [m.case_type as CaseType, m]))
  const lockRows = new Map(
    seed.action_locks.map((l) => [l.action_type as ActionType, Boolean(l.locked)]),
  )
  const ticketCase = new Map(
    seed.tickets.map((t) => [t.id as string, t.case_type as CaseType | null]),
  )
  const undone = new Map<CaseType, Set<string>>()
  for (const e of seed.action_executions) {
    if (e.executed_by !== 'auto' || e.status !== 'cancelled') continue
    const c = ticketCase.get(e.ticket_id as string)
    if (!c) continue
    if (!undone.has(c)) undone.set(c, new Set())
    undone.get(c)!.add(e.ticket_id as string)
  }
  const cases = sortCases(
    TEMPLATE_CASE_TYPES.map((caseType) => {
      const mode = modes.get(caseType)
      const decisions = seed.decisions
        .filter((d) => ticketCase.get(d.ticket_id as string) === caseType)
        .map((d) => ({ decision: d.decision as DecisionKind, decidedAt: String(d.decided_at) }))
      return buildTrackRecord(
        {
          caseType,
          decisions,
          mode: (mode?.mode as 'always_ask' | 'auto' | undefined) ?? 'always_ask',
          autoSince: mode ? String(mode.changed_at) : null,
          undos: undone.get(caseType)?.size ?? 0,
        },
        now,
      )
    }),
  )
  const onAutoCount = cases.filter((c) => c.mode === 'auto').length
  return {
    settings: seedSettings(seed),
    cases,
    locks: ACTION_LIST.filter((a) => a.lockable).map((a) => ({
      type: a.key,
      locked: lockRows.get(a.key) ?? a.lockedByDefault,
      lockable: a.lockable,
    })),
    onAutoCount,
    alwaysAskCount: cases.length - onAutoCount,
  }
}
