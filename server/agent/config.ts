/**
 * Runtime configuration of the agent. This is the ONLY place in `server/agent` that reads
 * environment variables, and it exposes read credentials only. The write credentials (the Stripe
 * write key, the InstaRadar write URL, the Linear write key, the Notion write token) never appear
 * here, so the agent code path cannot obtain them even by accident;
 * `tests/agent/credentials.test.ts` proves it.
 *
 * `process.env` is used instead of `useRuntimeConfig()` so the same module runs inside Nitro,
 * in vitest and in the eval runner.
 */

export const DEFAULT_AGENT_MODEL = 'claude-fable-5-1'
export const DEFAULT_AGENT_SMALL_MODEL = 'claude-sonnet-5'

export interface AgentRuntimeConfig {
  /** Claude API key (agent research + drafting). */
  anthropicApiKey: string
  /** Most capable model for the agent run. Env: AGENT_MODEL. */
  model: string
  /** Smaller model for the consistency check. Env: AGENT_SMALL_MODEL. */
  smallModel: string
  /** Restricted, read-only Stripe key. */
  stripeReadKey: string
  /** Postgres URL of a SELECT-only role on the InstaRadar Supabase. */
  instaradarDbReadUrl: string
  vercelApiToken: string
  vercelTeamId: string
  vercelInstaradarProjectId: string
  /** 'api' reads the Vercel runtime logs endpoint, 'drain' reads the log drain table (see README). */
  vercelLogsSource: 'api' | 'drain'
  /** Notion integration with read content only. */
  notionReadToken: string
  /** Linear read key. */
  linearReadApiKey: string
  linearTeamId: string
  supportMailbox: string
  siteUrl: string
  /** Maximum model round trips per run. */
  maxIterations: number
  /** Per-source timeout while researching (ms). */
  sourceTimeoutMs: number
  /** How long the Notion knowledge stays cached in the process (ms). */
  knowledgeCacheTtlMs: number
  /** Table and column names of the InstaRadar database (assumptions, env-overridable). */
  instaradarTables: InstaradarTables
}

/**
 * Table and column names of the InstaRadar Supabase database. The InstaRadar repository was not
 * reachable when this was written, so these are ASSUMPTIONS with sensible Supabase defaults.
 * Override with `INSTARADAR_TABLES` (a JSON object with the same shape, partial is fine).
 */
export interface InstaradarTables {
  users: {
    table: string
    id: string
    email: string
    plan: string
    status: string
    createdAt: string
    stripeCustomerId: string
    lastSignInAt: string
  }
  trackedProfiles: {
    table: string
    id: string
    userId: string
    handle: string
    createdAt: string
    active: string
  }
  signIns: { table: string; userId: string; createdAt: string; action: string }
  scans: {
    table: string
    userId: string
    handle: string
    createdAt: string
    status: string
    error: string
  }
  alerts: { table: string; userId: string; handle: string; type: string; createdAt: string }
  blockedProfiles: { table: string; handle: string; createdAt: string }
}

export const DEFAULT_INSTARADAR_TABLES: InstaradarTables = {
  users: {
    table: 'public.profiles',
    id: 'id',
    email: 'email',
    plan: 'plan',
    status: 'subscription_status',
    createdAt: 'created_at',
    stripeCustomerId: 'stripe_customer_id',
    lastSignInAt: 'last_sign_in_at',
  },
  trackedProfiles: {
    table: 'public.tracked_profiles',
    id: 'id',
    userId: 'user_id',
    handle: 'username',
    createdAt: 'created_at',
    active: 'is_active',
  },
  signIns: {
    table: 'auth.audit_log_entries',
    userId: "payload->>'actor_id'",
    createdAt: 'created_at',
    action: "payload->>'action'",
  },
  scans: {
    table: 'public.scans',
    userId: 'user_id',
    handle: 'username',
    createdAt: 'created_at',
    status: 'status',
    error: 'error',
  },
  alerts: {
    table: 'public.alerts',
    userId: 'user_id',
    handle: 'username',
    type: 'type',
    createdAt: 'created_at',
  },
  blockedProfiles: {
    table: 'public.blocked_profiles',
    handle: 'username',
    createdAt: 'created_at',
  },
}

function mergeTables(json: string | undefined): InstaradarTables {
  if (!json) return DEFAULT_INSTARADAR_TABLES
  let parsed: Partial<Record<keyof InstaradarTables, Record<string, string>>>
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('INSTARADAR_TABLES must be a JSON object')
  }
  const out = structuredClone(DEFAULT_INSTARADAR_TABLES) as unknown as Record<
    string,
    Record<string, string>
  >
  for (const [group, cols] of Object.entries(parsed)) {
    if (!out[group] || !cols) continue
    for (const [k, v] of Object.entries(cols)) if (typeof v === 'string') out[group]![k] = v
  }
  return out as unknown as InstaradarTables
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Read-only view of the environment. Never returns a write credential. */
export function agentRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AgentRuntimeConfig {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AGENT_MODEL || DEFAULT_AGENT_MODEL,
    smallModel: env.AGENT_SMALL_MODEL || DEFAULT_AGENT_SMALL_MODEL,
    stripeReadKey: env.STRIPE_READ_KEY || '',
    instaradarDbReadUrl: env.INSTARADAR_DB_READ_URL || '',
    vercelApiToken: env.VERCEL_API_TOKEN || '',
    vercelTeamId: env.VERCEL_TEAM_ID || '',
    vercelInstaradarProjectId: env.VERCEL_INSTARADAR_PROJECT_ID || '',
    vercelLogsSource: env.VERCEL_LOGS_SOURCE === 'drain' ? 'drain' : 'api',
    notionReadToken: env.NOTION_READ_TOKEN || '',
    linearReadApiKey: env.LINEAR_READ_API_KEY || '',
    linearTeamId: env.LINEAR_TEAM_ID || '',
    supportMailbox: env.SUPPORT_MAILBOX || 'support@instaradar.app',
    siteUrl: env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    maxIterations: int(env.AGENT_MAX_ITERATIONS, 16),
    sourceTimeoutMs: int(env.AGENT_SOURCE_TIMEOUT_MS, 20_000),
    knowledgeCacheTtlMs: int(env.KNOWLEDGE_CACHE_TTL_MS, 5 * 60_000),
    instaradarTables: mergeTables(env.INSTARADAR_TABLES),
  }
}

/** Every environment variable the agent reads. Used by the credentials test and the README. */
export const AGENT_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'AGENT_MODEL',
  'AGENT_SMALL_MODEL',
  'STRIPE_READ_KEY',
  'INSTARADAR_DB_READ_URL',
  'INSTARADAR_TABLES',
  'VERCEL_API_TOKEN',
  'VERCEL_TEAM_ID',
  'VERCEL_INSTARADAR_PROJECT_ID',
  'VERCEL_LOGS_SOURCE',
  'NOTION_READ_TOKEN',
  'LINEAR_READ_API_KEY',
  'LINEAR_TEAM_ID',
  'SUPPORT_MAILBOX',
  'NUXT_PUBLIC_SITE_URL',
  'AGENT_MAX_ITERATIONS',
  'AGENT_SOURCE_TIMEOUT_MS',
  'KNOWLEDGE_CACHE_TTL_MS',
] as const
