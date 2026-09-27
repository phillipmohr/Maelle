/**
 * Live eval: the same fixtures with the real model (AGENT_MODEL, default claude-fable-5-1) and fake
 * tools. Runs only when ANTHROPIC_API_KEY is set; otherwise every test is reported as skipped with
 * the reason in its name. Set LIVE_EVAL_ONLY=<fixture id substring> to run a subset.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { agentRuntimeConfig } from '../server/agent/config'
import { createAnthropicModelClient } from '../server/agent/model/anthropic'
import { ALL_FIXTURES, CASE_2_REFUND } from './fixtures'
import { checkExpectations, median, runFixture, runFollowUp, type HarnessRun } from './harness'

const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
const only = process.env.LIVE_EVAL_ONLY
const fixtures = only ? ALL_FIXTURES.filter((f) => f.id.includes(only)) : ALL_FIXTURES

if (!apiKey)
  console.log('live eval skipped: ANTHROPIC_API_KEY is not set (plumbing eval still runs)')

const rows: Record<string, unknown>[] = []
const durations: number[] = []

function record(run: HarnessRun, failures: string[]) {
  const p = run.proposal
  rows.push({
    fixture: run.fixture.id,
    case: p ? `${p.caseType} (${p.confidence?.toFixed(2)})` : '-',
    risk: p?.riskLevel ?? '-',
    actions: p
      ? p.actions
          .filter((a) => a.enabled)
          .map((a) => `${a.type}${a.stage === 'after_confirmation' ? '*' : ''}`)
          .join(', ')
      : '-',
    stage: p ? `${p.stage}${p.customerConfirmationNeeded ? ' (confirm)' : ''}` : '-',
    s: Math.round(run.durationMs / 1000),
    result: failures.length
      ? `FAIL: ${failures.join('; ')}`
      : run.result.status === 'succeeded'
        ? 'ok'
        : `run failed: ${run.result.error}`,
  })
  durations.push(run.durationMs)
  if (p?.reply)
    console.log(
      `\n=== ${run.fixture.id} · ${p.caseType} · ${p.summaryLine}\n${p.reply.body}\n${p.policyWarnings.length ? `policy: ${p.policyWarnings.join(' | ')}` : ''}`,
    )
}

describe.skipIf(!apiKey)(`live eval (${agentRuntimeConfig().model}, fake tools)`, () => {
  const model = apiKey ? createAnthropicModelClient(apiKey) : undefined

  for (const fixture of fixtures) {
    it(fixture.title, async () => {
      const run = await runFixture(fixture, {
        model,
        log: (m) => console.log(`[${fixture.id}] ${m}`),
      })
      const failures = checkExpectations(run.proposal, run.ticket, fixture.expect)
      record(run, failures)
      expect(run.result.status, run.result.error).toBe('succeeded')
      expect(failures).toEqual([])
    })
  }

  it.skipIf(!fixtures.includes(CASE_2_REFUND))('2b · "Yes, refund" → stage 2', async () => {
    const first = await runFixture(CASE_2_REFUND, { model })
    expect(first.result.status, first.result.error).toBe('succeeded')
    const second = await runFollowUp(first, { model })
    const failures = checkExpectations(
      second.proposal,
      second.ticket,
      CASE_2_REFUND.followUp!.expect,
    )
    record({ ...second, fixture: { ...CASE_2_REFUND, id: 'case-2b-refund-stage-2' } }, failures)
    expect(second.result.status, second.result.error).toBe('succeeded')
    expect(failures).toEqual([])
  })

  it('median run time is under 60 seconds', () => {
    expect(median(durations)).toBeLessThan(60_000)
  })

  afterAll(() => {
    console.log('\nLive eval summary')
    console.table(rows)
    console.log(
      `median ${Math.round(median(durations) / 1000)} s over ${durations.length} runs · * = after_confirmation`,
    )
  })
})

describe.skipIf(Boolean(apiKey))('live eval', () => {
  it.skip('skipped: ANTHROPIC_API_KEY is not set', () => {})
})
