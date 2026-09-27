#!/usr/bin/env node
/**
 * Downloads the self-hosted webfont subsets (latin, latin-ext) from Google Fonts into
 * app/assets/fonts, named <Family>-<weight>[-italic]-<subset>.woff2 as app/assets/css/fonts.css
 * expects. Run `pnpm fonts:fetch` after cloning when the fonts are missing, or to refresh them.
 * app/assets/fonts/SHA256SUMS lists the checksums of the files the design was built with; the
 * script reports which downloaded files still match.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FAMILIES = [
  { family: 'Geist', file: 'Geist', spec: 'wght@400;500;600' },
  { family: 'Geist Mono', file: 'GeistMono', spec: 'wght@400;500;600' },
  { family: 'Instrument Serif', file: 'InstrumentSerif', spec: 'ital,wght@0,400;1,400' },
]
const SUBSETS = new Set(['latin', 'latin-ext'])
// A modern browser UA makes the CSS API answer with woff2 sources and unicode-range subsets.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'app/assets/fonts')

async function main() {
  const query = FAMILIES.map(
    (f) => `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:${f.spec}`,
  ).join('&')
  const cssUrl = `https://fonts.googleapis.com/css2?${query}&display=swap`
  const css = await fetchText(cssUrl)
  const faces = parseFaces(css)
  if (faces.length === 0) throw new Error(`No @font-face blocks found in ${cssUrl}`)

  await mkdir(outDir, { recursive: true })
  const expected = await readSums(path.join(outDir, 'SHA256SUMS'))
  let written = 0
  let matched = 0
  let mismatched = 0
  for (const face of faces) {
    if (!SUBSETS.has(face.subset)) continue
    const fam = FAMILIES.find((f) => f.family === face.family)
    if (!fam) continue
    const italic = face.style === 'italic' ? '-italic' : ''
    const name = `${fam.file}-${face.weight}${italic}-${face.subset}.woff2`
    const bytes = new Uint8Array(await (await fetchOk(face.url)).arrayBuffer())
    await writeFile(path.join(outDir, name), bytes)
    written++
    const sum = createHash('sha256').update(bytes).digest('hex')
    const want = expected.get(name)
    const state = want ? (want === sum ? 'matches SHA256SUMS' : 'differs from SHA256SUMS') : 'new'
    if (want === sum) matched++
    else if (want) mismatched++
    console.log(`${name.padEnd(48)} ${bytes.length.toString().padStart(7)} bytes  ${state}`)
  }
  console.log(`\n${written} files written, ${matched} match SHA256SUMS, ${mismatched} differ.`)
  if (written < 16) {
    console.warn(
      'Expected 16 files (3 families, latin + latin-ext); check FAMILIES and the CSS API.',
    )
    process.exitCode = 1
  }
}

function parseFaces(css) {
  const out = []
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  for (const m of css.matchAll(re)) {
    const body = m[2]
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1]
    const style = body.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal'
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1]
    const url = body.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/)?.[1]
    if (family && weight && url) out.push({ subset: m[1], family, style, weight, url })
  }
  return out
}

async function fetchOk(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res
}
async function fetchText(url) {
  return (await fetchOk(url)).text()
}
async function readSums(file) {
  const map = new Map()
  try {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/)
      if (m) map.set(m[2].trim(), m[1])
    }
  } catch {
    // no SHA256SUMS yet
  }
  return map
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
