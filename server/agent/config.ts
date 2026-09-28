/**
 * Runtime configuration of the agent. This is the ONLY place in `server/agent` that reads
 * environment variables. The agent is read-only by construction: its Stripe, InstaRadar, Notion and
 * Linear clients implement read calls only, and the module tree never imports the executor
 * (`tests/agent/credentials.test.ts` proves both). One key per service is shared with the executor.
 *
 * Everything that is not a secret (models, the InstaRadar project, the Linear team, the mailbox,
 * the tuning knobs) is hardcoded in `shared/config.ts`.
 *
 * `process.env` is used instead of `useRuntimeConfig()` so the same module runs inside Nitro,
 * in vitest and in the eval runner.
 */
import { AGENT, INSTARADAR, LINEAR, MAILBOX, MODELS } from '#shared/config'

export interface AgentRuntimeConfig {
  /** Claude API key (agent research + drafting). */
  anthropicApiKey: string
  /** Most capable model for the agent run. */
  model: string
  /** Smaller model for the consistency check. */
  smallModel: string
  /** Stripe secret key (the agent only ever reads with it). */
  stripeKey: string
  /** Postgres URL of the InstaRadar database (the agent opens read-only transactions). */
  instaradarDbUrl: string
  vercelApiToken: string
  /** Vercel team slug and project name of InstaRadar (runtime logs). */
  vercelTeamSlug: string
  vercelProject: string
  /** Notion integration token. */
  notionToken: string
  /** Linear API key. */
  linearApiKey: string
  linearTeamId: string
  supportMailbox: string
  siteUrl: string
  /** Maximum model round trips per run. */
  maxIterations: number
  /** Per-source timeout while researching (ms). */
  sourceTimeoutMs: number
  /** How long the Notion knowledge stays cached in the process (ms). */
  knowledgeCacheTtlMs: number
}

/**
 * The public URL of this Maelle deployment, for links in notifications. `NUXT_PUBLIC_SITE_URL`
 * overrides (custom domain); otherwise Vercel's own production URL; otherwise the dev server.
 */
export function siteUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NUXT_PUBLIC_SITE_URL) return env.NUXT_PUBLIC_SITE_URL
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  return 'http://localhost:3000'
}

/** The agent's view of the environment: its own variables and nothing else. */
export function agentRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AgentRuntimeConfig {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    model: MODELS.agent,
    smallModel: MODELS.small,
    stripeKey: env.STRIPE_SECRET_KEY || '',
    instaradarDbUrl: env.INSTARADAR_DB_URL || '',
    vercelApiToken: env.VERCEL_API_TOKEN || '',
    vercelTeamSlug: INSTARADAR.vercel.teamSlug,
    vercelProject: INSTARADAR.vercel.project,
    notionToken: env.NOTION_TOKEN || '',
    linearApiKey: env.LINEAR_API_KEY || '',
    linearTeamId: LINEAR.teamId,
    supportMailbox: MAILBOX.address,
    siteUrl: siteUrlFromEnv(env),
    maxIterations: AGENT.maxIterations,
    sourceTimeoutMs: AGENT.sourceTimeoutMs,
    knowledgeCacheTtlMs: AGENT.knowledgeCacheTtlMs,
  }
}

/** Every environment variable the agent reads. Used by the credentials test and the README. */
export const AGENT_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'INSTARADAR_DB_URL',
  'VERCEL_API_TOKEN',
  'NOTION_TOKEN',
  'LINEAR_API_KEY',
  'NUXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const
