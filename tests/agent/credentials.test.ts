/**
 * The agent code path has no access to write credentials. Static: nothing under server/agent (or
 * the agent's routes and plugin) references a write key name or imports the executor. Runtime: the
 * agent's config accessor exposes read keys only, even when the environment holds write keys.
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

const WRITE_KEY_NAMES = [
  'STRIPE_WRITE_KEY',
  'INSTARADAR_DB_WRITE_URL',
  'LINEAR_WRITE_API_KEY',
  'NOTION_WRITE_TOKEN',
  'stripeWriteKey',
  'instaradarDbWriteUrl',
  'linearWriteApiKey',
  'notionWriteToken',
]

describe('agent credentials (static)', () => {
  it('covers the agent module tree', () => {
    expect(AGENT_FILES.length).toBeGreaterThan(20)
  })

  it('never references a write credential name', () => {
    for (const file of AGENT_FILES) {
      const src = readFileSync(file, 'utf8')
      for (const name of WRITE_KEY_NAMES) {
        expect(src.includes(name), `${path.relative(ROOT, file)} references ${name}`).toBe(false)
      }
    }
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
})

describe('agent credentials (runtime)', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant-read',
    STRIPE_READ_KEY: 'rk_live_read',
    STRIPE_WRITE_KEY: 'rk_live_WRITE_SECRET',
    INSTARADAR_DB_READ_URL: 'postgresql://reader@db/instaradar',
    INSTARADAR_DB_WRITE_URL: 'postgresql://WRITER_SECRET@db/instaradar',
    LINEAR_READ_API_KEY: 'lin_read',
    LINEAR_WRITE_API_KEY: 'lin_WRITE_SECRET',
    NOTION_READ_TOKEN: 'ntn_read',
    NOTION_WRITE_TOKEN: 'ntn_WRITE_SECRET',
    VERCEL_API_TOKEN: 'vercel_read',
  } as NodeJS.ProcessEnv

  it('exposes read keys only', () => {
    const config = agentRuntimeConfig(env)
    const json = JSON.stringify(config)
    expect(json).not.toContain('WRITE_SECRET')
    expect(json).not.toContain('WRITER_SECRET')
    for (const key of Object.keys(config)) expect(key).not.toMatch(/write/i)
    expect(config.stripeReadKey).toBe('rk_live_read')
    expect(config.instaradarDbReadUrl).toBe('postgresql://reader@db/instaradar')
    expect(config.linearReadApiKey).toBe('lin_read')
    expect(config.notionReadToken).toBe('ntn_read')
  })

  it('lists no write variable among the variables it reads', () => {
    for (const v of AGENT_ENV_VARS) expect(v).not.toMatch(/WRITE/)
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
