/**
 * Plumbing eval: the 7 test cases and the 10 Notion examples through the real loop, the real tool
 * dispatch, the finaliser and the store, with the ScriptedModelClient standing in for Claude. It
 * proves that a correct model answer yields the expected proposal and that the deterministic parts
 * (risk floor, due date, confirmation stage, attachment, policy warnings) do their job. Runs in CI
 * without credentials.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { ALL_FIXTURES, CASE_2_REFUND } from './fixtures'
import { checkExpectations, median, runFixture, runFollowUp, type HarnessRun } from './harness'

interface Row {
  fixture: string
  case: string
  risk: string
  actions: string
  stage: string
  ms: number
  result: string
}

const rows: Row[] = []
const durations: number[] = []

function record(run: HarnessRun, failures: string[]) {
  const p = run.proposal
  rows.push({
    fixture: run.fixture.id,
    case: p?.caseType ?? '-',
    risk: p?.riskLevel ?? '-',
    actions: p
      ? p.actions
          .filter((a) => a.enabled)
          .map((a) => `${a.type}${a.stage === 'after_confirmation' ? '*' : ''}`)
          .join(', ')
      : '-',
    stage: p ? `${p.stage}${p.customerConfirmationNeeded ? ' (confirm)' : ''}` : '-',
    ms: run.durationMs,
    result: failures.length
      ? `FAIL: ${failures.join('; ')}`
      : run.result.status === 'succeeded'
        ? 'ok'
        : `run ${run.result.status}: ${run.result.error}`,
  })
  durations.push(run.durationMs)
}

describe('plumbing eval (scripted model, fake tools)', () => {
  for (const fixture of ALL_FIXTURES) {
    it(fixture.title, async () => {
      const run = await runFixture(fixture)
      const failures = checkExpectations(run.proposal, run.ticket, fixture.expect)
      record(run, failures)
      expect(run.result.status, run.result.error).toBe('succeeded')
      expect(failures).toEqual([])
      // Every source settled: no pending entry left in the live checklist.
      expect(Object.values(run.result.progress)).not.toContain('pending')
    })
  }

  it('2b · customer replies "Yes, refund" → stage 2 with the queued actions now', async () => {
    const first = await runFixture(CASE_2_REFUND)
    expect(first.result.status).toBe('succeeded')
    const second = await runFollowUp(first)
    const failures = checkExpectations(
      second.proposal,
      second.ticket,
      CASE_2_REFUND.followUp!.expect,
    )
    record({ ...second, fixture: { ...CASE_2_REFUND, id: 'case-2b-refund-stage-2' } }, failures)
    expect(second.result.status, second.result.error).toBe('succeeded')
    expect(failures).toEqual([])
    expect(second.proposal?.version).toBe(2)
    expect(second.store.proposals.find((p) => p.version === 1)?.status).toBe('superseded')
  })

  it('median run time is under 60 seconds', () => {
    expect(median(durations)).toBeLessThan(60_000)
  })

  afterAll(() => {
    console.log('\nPlumbing eval summary')
    console.table(rows)
    console.log(
      `median ${Math.round(median(durations))} ms over ${durations.length} runs · * = after_confirmation`,
    )
  })
})
