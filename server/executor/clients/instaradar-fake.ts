/** In-memory InstaRadar database for tests and the dev server. */
import type { ProviderError } from '../errors'
import type { InstaradarWriteClient } from './instaradar'

export interface FakeInstaradar extends InstaradarWriteClient {
  readonly state: {
    /** userId → rows per table */
    users: Map<string, Record<string, number>>
    /** handle → { userId } */
    tracked: { handle: string; userId: string }[]
    blocked: Map<string, { reason: string; source: string }>
  }
  readonly calls: { op: string; args: unknown[] }[]
  failNext(op: 'userExists' | 'blockProfile' | 'deleteUserData', error: ProviderError): void
  addUser(userId: string, rows?: Record<string, number>): void
  track(handle: string, userId: string): void
  reset(): void
}

export function createFakeInstaradar(): FakeInstaradar {
  const state: FakeInstaradar['state'] = { users: new Map(), tracked: [], blocked: new Map() }
  const calls: FakeInstaradar['calls'] = []
  const failures = new Map<string, ProviderError>()
  function record(op: string, args: unknown[]) {
    calls.push({ op, args })
    const f = failures.get(op)
    if (f) {
      failures.delete(op)
      throw f
    }
  }
  return {
    state,
    calls,
    failNext(op, error) {
      failures.set(op, error)
    },
    addUser(userId, rows = { tracked_profiles: 2, profiles: 1 }) {
      state.users.set(userId, { ...rows })
    },
    track(handle, userId) {
      state.tracked.push({ handle: handle.replace(/^@/, '').toLowerCase(), userId })
    },
    reset() {
      state.users.clear()
      state.tracked.length = 0
      state.blocked.clear()
      calls.length = 0
      failures.clear()
    },
    async userExists(userId) {
      record('userExists', [userId])
      return state.users.has(userId)
    },
    async blockProfile(handle, reason, source) {
      record('blockProfile', [handle, reason, source])
      const h = handle.replace(/^@/, '').toLowerCase()
      const alreadyBlocked = state.blocked.has(h)
      if (!alreadyBlocked) state.blocked.set(h, { reason, source })
      const before = state.tracked.length
      state.tracked = state.tracked.filter((t) => t.handle !== h)
      return { handle: h, alreadyBlocked, trackingStopped: before - state.tracked.length }
    },
    async deleteUserData(userId) {
      record('deleteUserData', [userId])
      const rows = state.users.get(userId)
      if (!rows) return { deleted: {}, found: false }
      state.users.delete(userId)
      state.tracked = state.tracked.filter((t) => t.userId !== userId)
      return { deleted: rows, found: true }
    },
  }
}
