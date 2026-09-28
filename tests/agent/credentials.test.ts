/**
 * The agent is read-only by construction. Static: nothing under server/agent (or the agent's routes
 * and plugin) imports the executor, and only config.ts reads the environment. Runtime: the agent's
 * config accessor exposes the agent's own variables and none of the other secrets, even when the
 * environment holds them.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_ENV_VARS, agentRuntimeConfig, siteUrlFromEnv } from '../../server/agent/config'

const ROOT = path.resolve(__dirname, '..', '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|js|mjs|sql)$/.test(name)) out.push(p)
  }
  return out
}

const AGENT_FILES = [
  ...walk(path.join(ROOT, 'server', 'agent')),
  ...walk(path.join(ROOT, 'server', 'api', 'agent')),
  path.join(ROOT, 'server', 'api', 'tickets', '[id]', 'rerun.post.ts'),
  path.join(ROOT, 'server', 'plugins', 'agent.ts'),
]

/** Secrets that belong to other parts of Maelle and must never reach the agent. */
const FOREIGN_SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_FOREIGN',
  SUPABASE_DB_URL: 'postgresql://FOREIGN@db/maelle',
  MAIL_PASSWORD: 'mail-FOREIGN',
  CRON_SECRET: 'cron-FOREIGN',
  INSTARADAR_SUPABASE_SERVICE_ROLE_KEY: 'service-role-FOREIGN',
  LINEAR_WEBHOOK_SECRET: 'webhook-FOREIGN',
}

describe('agent credentials (static)', () => {
  it('covers the agent module tree', () => {
    expect(AGENT_FILES.length).toBeGreaterThan(20)
  })

  it('never imports the executor', () => {
    for (const file of AGENT_FILES) {
      const src = readFileSync(file, 'utf8')
      expect(
        /from\s+['"][^'"]*\/executor(\/|['"])/.test(src),
        `${path.relative(ROOT, file)} imports the executor`,
      ).toBe(false)
      expect(
        /import\(['"][^'"]*\/executor/.test(src),
        `${path.relative(ROOT, file)} imports the executor`,
      ).toBe(false)
    }
  })

  it('reads the environment only in config.ts', () => {
    for (const file of walk(path.join(ROOT, 'server', 'agent'))) {
      if (file.endsWith(`${path.sep}config.ts`)) continue
      const src = readFileSync(file, 'utf8').replace(/process\.env\.NODE_ENV/g, '')
      expect(src.includes('process.env'), `${path.relative(ROOT, file)} reads process.env`).toBe(
        false,
      )
    }
  })

  it('never names a secret that belongs to another part of Maelle', () => {
    // SUPABASE_DB_URL is the agent's own store (it writes proposals there) and may appear in its
    // "database is not configured" messages; every other secret is off limits even by name.
    const names = Object.keys(FOREIGN_SECRETS).filter((n) => n !== 'SUPABASE_DB_URL')
    for (const file of AGENT_FILES) {
      const src = readFileSync(file, 'utf8')
      for (const name of names) {
        expect(src.includes(name), `${path.relative(ROOT, file)} references ${name}`).toBe(false)
      }
    }
  })
})

describe('agent credentials (runtime)', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant-agent',
    STRIPE_SECRET_KEY: 'sk_live_shared',
    INSTARADAR_DB_URL: 'postgresql://maelle@db/instaradar',
    LINEAR_API_KEY: 'lin_shared',
    NOTION_TOKEN: 'ntn_shared',
    VERCEL_API_TOKEN: 'vercel_read',
    ...FOREIGN_SECRETS,
  } as NodeJS.ProcessEnv

  it('exposes the agent variables and nothing else', () => {
    const config = agentRuntimeConfig(env)
    const json = JSON.stringify(config)
    expect(json).not.toContain('FOREIGN')
    expect(config.stripeKey).toBe('sk_live_shared')
    expect(config.instaradarDbUrl).toBe('postgresql://maelle@db/instaradar')
    expect(config.linearApiKey).toBe('lin_shared')
    expect(config.notionToken).toBe('ntn_shared')
    expect(config.vercelApiToken).toBe('vercel_read')
  })

  it('lists one variable per service and no foreign secret among the variables it reads', () => {
    for (const name of Object.keys(FOREIGN_SECRETS)) expect(AGENT_ENV_VARS).not.toContain(name)
    for (const v of AGENT_ENV_VARS) expect(v).not.toMatch(/READ|WRITE/)
    expect(AGENT_ENV_VARS).toContain('STRIPE_SECRET_KEY')
    expect(AGENT_ENV_VARS).toContain('INSTARADAR_DB_URL')
  })

  it('uses the models and the InstaRadar project fixed in shared/config.ts', () => {
    const c = agentRuntimeConfig({} as NodeJS.ProcessEnv)
    expect(c.model).toBe('claude-fable-5-1')
    expect(c.smallModel).toBe('claude-sonnet-5')
    expect(c.vercelTeamSlug).toBe('phillip-mohrs-projects')
    expect(c.vercelProject).toBe('instaradar')
    expect(c.supportMailbox).toBe('support@instaradar.app')
  })

  it('derives the site URL from Vercel unless a custom domain overrides it', () => {
    expect(siteUrlFromEnv({} as NodeJS.ProcessEnv)).toBe('http://localhost:3000')
    expect(
      siteUrlFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: 'maelle.vercel.app' } as NodeJS.ProcessEnv),
    ).toBe('https://maelle.vercel.app')
    expect(
      siteUrlFromEnv({
        NUXT_PUBLIC_SITE_URL: 'https://maelle.instaradar.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'maelle.vercel.app',
      } as NodeJS.ProcessEnv),
    ).toBe('https://maelle.instaradar.app')
  })
})
