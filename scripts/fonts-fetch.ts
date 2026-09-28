/**
 * Refreshes the self-hosted webfont subsets from Google Fonts. The expected files are the ones
 * app/assets/css/fonts.css references (<Family>-<weight>[-italic]-<subset>.woff2), so the script
 * and the stylesheet cannot drift apart. Every downloaded file is hashed before anything is
 * written: a file that matches app/assets/fonts/SHA256SUMS is left alone, a file that differs is
 * reported and skipped (exit 1) unless --update is passed, which writes the new bytes and rewrites
 * SHA256SUMS. The fonts are tracked in git, so a fresh clone never needs this; run
 * `pnpm fonts:fetch` to check for upstream changes and `pnpm fonts:fetch --update` to take them.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FAMILIES: Record<string, { family: string; spec: string }> = {
  Geist: { family: 'Geist', spec: 'wght@400;500;600' },
  GeistMono: { family: 'Geist Mono', spec: 'wght@400;500;600' },
  InstrumentSerif: { family: 'Instrument Serif', spec: 'ital,wght@0,400;1,400' },
}
// A modern browser UA makes the CSS API answer with woff2 sources and unicode-range subsets.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const root = path.resolve(import.meta.dirname, '..')
const fontsDir = path.join(root, 'app/assets/fonts')
const sumsFile = path.join(fontsDir, 'SHA256SUMS')
const cssFile = path.join(root, 'app/assets/css/fonts.css')

interface Face {
  subset: string
  family: string
  style: string
  weight: string
  url: string
}

async function main() {
  const update = process.argv.includes('--update')
  const expected = await expectedFiles()
  if (expected.length === 0) throw new Error(`No ../fonts/*.woff2 references found in ${cssFile}`)

  const query = Object.values(FAMILIES)
    .map((f) => `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:${f.spec}`)
    .join('&')
  const cssUrl = `https://fonts.googleapis.com/css2?${query}&display=swap`
  const faces = parseFaces(await fetchText(cssUrl))
  if (faces.length === 0) throw new Error(`No @font-face blocks found in ${cssUrl}`)
  const byName = new Map(faces.map((f) => [fileName(f), f] as const))

  // Download each distinct URL once, in parallel (the variable fonts share one file per subset).
  const downloads = new Map<string, Promise<Uint8Array>>()
  const bytesFor = (url: string) => {
    let p = downloads.get(url)
    if (!p) {
      p = fetchOk(url).then(async (res) => new Uint8Array(await res.arrayBuffer()))
      downloads.set(url, p)
    }
    return p
  }
  const fetched = await Promise.all(
    expected.map(async (name) => {
      const face = byName.get(name)
      if (!face) return { name, bytes: null }
      return { name, bytes: await bytesFor(face.url) }
    }),
  )

  const sums = await readSums()
  const next = new Map(sums)
  let missing = 0
  let unchanged = 0
  let changed = 0
  let added = 0
  await mkdir(fontsDir, { recursive: true })
  for (const { name, bytes } of fetched) {
    if (!bytes) {
      missing++
      console.log(`${name.padEnd(48)} not served by Google Fonts for the requested families`)
      continue
    }
    const sum = createHash('sha256').update(bytes).digest('hex')
    const want = sums.get(name)
    const size = bytes.length.toString().padStart(7)
    if (want === sum) {
      unchanged++
      console.log(`${name.padEnd(48)} ${size} bytes  unchanged`)
      continue
    }
    if (want && !update) {
      changed++
      console.log(
        `${name.padEnd(48)} ${size} bytes  DIFFERS from SHA256SUMS (kept; --update takes it)`,
      )
      continue
    }
    await writeFile(path.join(fontsDir, name), bytes)
    next.set(name, sum)
    if (want) changed++
    else added++
    console.log(`${name.padEnd(48)} ${size} bytes  ${want ? 'updated' : 'added'}`)
  }
  if (update || added > 0) await writeSums(next)

  console.log(
    `\n${expected.length} files referenced by fonts.css: ${unchanged} unchanged, ${changed} ${update ? 'updated' : 'differ'}, ${added} added, ${missing} missing.`,
  )
  if (missing > 0 || (changed > 0 && !update)) process.exitCode = 1
}

/** The woff2 files fonts.css references, in order of appearance. */
async function expectedFiles(): Promise<string[]> {
  const css = await readFile(cssFile, 'utf8')
  const names = new Set<string>()
  for (const m of css.matchAll(/url\(['"]?\.\.\/fonts\/([^'")]+\.woff2)['"]?\)/g)) names.add(m[1]!)
  return [...names]
}

function fileName(face: Face): string {
  const fam = Object.entries(FAMILIES).find(([, f]) => f.family === face.family)?.[0]
  const italic = face.style === 'italic' ? '-italic' : ''
  return `${fam ?? face.family.replace(/\s+/g, '')}-${face.weight}${italic}-${face.subset}.woff2`
}

function parseFaces(css: string): Face[] {
  const out: Face[] = []
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  for (const m of css.matchAll(re)) {
    const body = m[2]!
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1]
    const style = body.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal'
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1]
    const url = body.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/)?.[1]
    if (family && weight && url) out.push({ subset: m[1]!, family, style, weight, url })
  }
  return out
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res
}
async function fetchText(url: string): Promise<string> {
  return (await fetchOk(url)).text()
}

async function readSums(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let text: string
  try {
    text = await readFile(sumsFile, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return map
    throw err
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/)
    if (m) map.set(m[2]!.trim(), m[1]!)
  }
  return map
}

async function writeSums(map: Map<string, string>): Promise<void> {
  const lines = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  await writeFile(sumsFile, lines.map(([name, sum]) => `${sum}  ${name}\n`).join(''))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
