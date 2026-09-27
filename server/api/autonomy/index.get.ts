/**
 * GET /api/autonomy — owner: IRDR-459. Foundation stub computes the track record from the seed
 * decisions with the recommendation rules of the ticket.
 */
import type { AutonomyResponse, CaseTrackRecord, SettingsRow } from '#shared/api'
import { ACTION_LIST } from '#shared/actions'
import { CASE_TYPES, TEMPLATE_CASE_TYPES, type CaseType } from '#shared/case-types'
import { seedBundle, stubHeaders } from '../../utils/stubs'

export default defineEventHandler((event): AutonomyResponse => {
  stubHeaders(event, 'IRDR-459')
  const seed = seedBundle()
  const settingsRow = seed.settings[0]!
  const settings: SettingsRow = {
    appId: settingsRow.app_id as string,
    globalPause: settingsRow.global_pause as boolean,
    undoWindowMinutes: settingsRow.undo_window_minutes as 5 | 10 | 15,
    digestTime: settingsRow.digest_time as string,
    timezone: settingsRow.timezone as string,
    followUpDays: settingsRow.follow_up_days as number,
    autoCloseDays: settingsRow.auto_close_days as number,
    refundDailyLimitCount: settingsRow.refund_daily_limit_count as number,
    refundDailyLimitAmountCents: settingsRow.refund_daily_limit_amount_cents as number,
    notifyEmail: (settingsRow.notify_email as string | null) ?? null,
  }
  const modes = new Map(seed.autonomy_modes.map((m) => [m.case_type as CaseType, m]))
  const locks = new Map(
    seed.action_locks.map((l) => [l.action_type as string, l.locked as boolean]),
  )

  const cases: CaseTrackRecord[] = TEMPLATE_CASE_TYPES.map((caseType) => {
    const tickets = seed.tickets.filter((t) => t.case_type === caseType)
    const decisions = seed.decisions
      .filter((d) => tickets.some((t) => t.id === d.ticket_id) && d.decision !== 'snoozed')
      .sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)))
      .slice(-30)
    const ticks = decisions.map((d) =>
      d.decision === 'rejected' || d.decision === 'handled_manually'
        ? 'rejected'
        : d.decision === 'approved_with_edits'
          ? 'edited'
          : 'unchanged',
    ) as CaseTrackRecord['ticks']
    const total = ticks.length
    const unchanged = ticks.filter((t) => t === 'unchanged').length
    const edited = ticks.filter((t) => t === 'edited').length
    const rejected = ticks.filter((t) => t === 'rejected').length
    const irreversible = CASE_TYPES[caseType].defaultActions.some(
      (a) => ACTION_LIST.find((x) => x.key === a)?.irreversible,
    )
    const mode = (modes.get(caseType)?.mode as 'always_ask' | 'auto') ?? 'always_ask'
    let recommendation: string
    let kind: CaseTrackRecord['recommendationKind']
    if (mode === 'auto') {
      const since = new Date(String(modes.get(caseType)?.changed_at)).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
      recommendation = `On Auto since ${since} · 0 undos`
      kind = 'on_auto'
    } else if (irreversible) {
      recommendation = 'Keep asking · irreversible actions'
      kind = 'keep_asking'
    } else if (rejected > 0) {
      recommendation = `Keep asking · ${rejected} rejected`
      kind = 'keep_asking'
    } else if (total < 15) {
      recommendation = `Collecting · ${15 - total} more tickets`
      kind = 'collecting'
    } else if (unchanged / total >= 0.9) {
      recommendation = 'Ready for Auto'
      kind = 'ready'
    } else {
      recommendation = 'Keep asking · too many edits'
      kind = 'keep_asking'
    }
    return {
      caseType,
      typicalActions: [...CASE_TYPES[caseType].defaultActions],
      ticks,
      total,
      unchanged,
      edited,
      rejected,
      recommendation,
      recommendationKind: kind,
      mode,
      autoSince: mode === 'auto' ? String(modes.get(caseType)?.changed_at) : null,
      undos: 0,
    }
  })
    .filter((c) => c.total > 0 || c.mode === 'auto')
    .sort((a, b) => b.total - a.total)

  const onAutoCount = cases.filter((c) => c.mode === 'auto').length
  return {
    settings,
    cases,
    locks: ACTION_LIST.filter((a) => a.lockable).map((a) => ({
      type: a.key,
      locked: locks.get(a.key) ?? a.lockedByDefault,
      lockable: a.lockable,
    })),
    onAutoCount,
    alwaysAskCount: TEMPLATE_CASE_TYPES.length - onAutoCount,
  }
})
