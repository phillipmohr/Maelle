/**
 * pnpm db:local start|stop|url
 * A throwaway Postgres 16 cluster in .data/pg for tests and local development without Docker.
 * Needs the PostgreSQL server binaries (initdb, pg_ctl). When run as root it switches to the
 * `postgres` system user, because Postgres refuses to run as root.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './lib/db'

export const LOCAL_PG_PORT = Number(process.env.LOCAL_PG_PORT || 54329)
export const LOCAL_PG_URL = `postgresql://postgres@127.0.0.1:${LOCAL_PG_PORT}/postgres`

function findBinDir(): string | null {
  const candidates = [
    process.env.PG_BIN_DIR,
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/lib/postgresql/15/bin',
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/opt/postgresql@16/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]
  for (const c of candidates) {
    if (c && existsSync(path.join(c, 'pg_ctl')) && existsSync(path.join(c, 'initdb'))) return c
  }
  try {
    const dirs = readdirSync('/usr/lib/postgresql').sort().reverse()
    for (const d of dirs) {
      const bin = `/usr/lib/postgresql/${d}/bin`
      if (existsSync(path.join(bin, 'pg_ctl'))) return bin
    }
  } catch {
    /* no /usr/lib/postgresql */
  }
  return null
}

function runAs(cmd: string, args: string[]) {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  if (isRoot) {
    const line = [cmd, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')
    return spawnSync('su', ['postgres', '-c', line], { stdio: 'pipe', encoding: 'utf8' })
  }
  return spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' })
}

export function dataDir(): string {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  // The postgres system user cannot read the repo when we run as root; use its home instead.
  return isRoot ? '/var/lib/postgresql/maelle-local' : path.join(ROOT, '.data', 'pg')
}

export function start(): string {
  const bin = findBinDir()
  if (!bin)
    throw new Error(
      'PostgreSQL server binaries not found (initdb, pg_ctl). Install postgresql or set PG_BIN_DIR.',
    )
  const dir = dataDir()
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  if (!existsSync(path.join(dir, 'PG_VERSION'))) {
    mkdirSync(dir, { recursive: true })
    if (isRoot) execFileSync('chown', ['postgres:postgres', dir])
    const r = runAs(path.join(bin, 'initdb'), [
      '-D',
      dir,
      '-U',
      'postgres',
      '--auth=trust',
      '-E',
      'UTF8',
    ])
    if (r.status !== 0) throw new Error(`initdb failed: ${r.stderr}`)
  }
  const status = runAs(path.join(bin, 'pg_ctl'), ['-D', dir, 'status'])
  if (status.status !== 0) {
    const socketDir = isRoot ? '/tmp' : os.tmpdir()
    const r = runAs(path.join(bin, 'pg_ctl'), [
      '-D',
      dir,
      '-o',
      `-p ${LOCAL_PG_PORT} -k ${socketDir} -c listen_addresses=127.0.0.1`,
      '-l',
      path.join(dir, 'log'),
      '-w',
      'start',
    ])
    if (r.status !== 0) throw new Error(`pg_ctl start failed: ${r.stderr}\n${r.stdout}`)
  }
  return LOCAL_PG_URL
}

export function stop() {
  const bin = findBinDir()
  if (!bin) return
  const dir = dataDir()
  if (!existsSync(path.join(dir, 'PG_VERSION'))) return
  runAs(path.join(bin, 'pg_ctl'), ['-D', dir, '-m', 'fast', 'stop'])
}

if (process.argv[1] && /local-pg\.(ts|js)$/.test(process.argv[1])) {
  const cmd = process.argv[2] ?? 'start'
  if (cmd === 'start') {
    console.log(start())
  } else if (cmd === 'stop') {
    stop()
    console.log('stopped')
  } else if (cmd === 'url') {
    console.log(LOCAL_PG_URL)
  } else {
    console.error('usage: pnpm db:local start|stop|url')
    process.exit(1)
  }
}
