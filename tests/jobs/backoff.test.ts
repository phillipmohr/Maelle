import { describe, expect, it } from 'vitest'
import { shouldAlertOnFailures } from '../../server/jobs/runner'
import { backoffMs, isRecurringJobType, jobDefaults } from '../../server/jobs/types'

describe('backoff and defaults', () => {
  const d = { backoffBaseMs: 60_000, backoffCapMs: 30 * 60_000 }

  it('doubles per attempt with jitter and a cap', () => {
    expect(backoffMs(1, d, () => 0)).toBe(60_000)
    expect(backoffMs(2, d, () => 0)).toBe(120_000)
    expect(backoffMs(3, d, () => 0)).toBe(240_000)
    expect(backoffMs(10, d, () => 0)).toBe(30 * 60_000)
    expect(backoffMs(1, d, () => 1)).toBe(72_000)
    const withJitter = backoffMs(1, d)
    expect(withJitter).toBeGreaterThanOrEqual(60_000)
    expect(withJitter).toBeLessThanOrEqual(72_000)
  })

  it('knows recurring types and per-type defaults', () => {
    expect(isRecurringJobType('fetch_mail')).toBe(true)
    expect(isRecurringJobType('agent_run')).toBe(false)
    expect(jobDefaults('agent_run')).toMatchObject({ maxAttempts: 4, lockTtlSeconds: 600 })
    expect(jobDefaults('fetch_mail').maxAttempts).toBe(1)
  })

  it('alerts at the threshold and then every 60 failures', () => {
    expect(shouldAlertOnFailures(2, 3)).toBe(false)
    expect(shouldAlertOnFailures(3, 3)).toBe(true)
    expect(shouldAlertOnFailures(4, 3)).toBe(false)
    expect(shouldAlertOnFailures(63, 3)).toBe(true)
    expect(shouldAlertOnFailures(1, 0)).toBe(false)
  })
})
