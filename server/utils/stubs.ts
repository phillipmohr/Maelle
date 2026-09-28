/**
 * Seed-backed stub responses for routes whose owners have not shipped yet. When Supabase is
 * configured the real tables are used where the foundation can (tickets list/detail); otherwise
 * the design's seed data answers, so the UI can be built offline.
 */
import type { H3Event } from 'h3'
import type { RouteOwner } from '#shared/api'
import { OWNER } from '#shared/config'
import { buildSeed, type SeedBundle } from '#shared/seed/data'

let cachedSeed: { at: number; bundle: SeedBundle } | null = null

/** Seed bundle relative to now, cached for a minute so relative ages stay stable across a page load. */
export function seedBundle(): SeedBundle {
  const now = Date.now()
  if (!cachedSeed || now - cachedSeed.at > 60_000) {
    cachedSeed = { at: now, bundle: buildSeed(new Date(now), OWNER.email) }
  }
  return cachedSeed.bundle
}

/** Marks a response as coming from a stub so the UI can show a hint in dev. */
export function stubHeaders(event: H3Event, owner: RouteOwner): void {
  setHeader(event, 'x-maelle-stub', owner)
}

/** 501 for write routes that are not implemented yet, naming the owning ticket. */
export function notImplemented(owner: RouteOwner, what: string): never {
  throw createError({
    statusCode: 501,
    statusMessage: `${what} is not implemented yet. Owner: ${owner}.`,
    data: { owner, stub: true },
  })
}
