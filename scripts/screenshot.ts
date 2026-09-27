/**
 * pnpm screenshot <path> [out.png] [--width 1512] [--height 944]
 * Screenshots a page of the running dev server (default http://localhost:3000) at the design's frame
 * size, so screens can be compared side by side with the Claude Design project. Uses the Chromium
 * that Playwright finds (PLAYWRIGHT_BROWSERS_PATH or the default install).
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')),
)
const pagePath = positional[0] ?? '/anastasai'
const out =
  positional[1] ??
  path.join(
    '.data',
    'screenshots',
    `${pagePath.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'index'}.png`,
  )
const base = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000'
const width = Number(flag('width', '1512'))
const height = Number(flag('height', '944'))
const fullPage = args.includes('--full')

mkdirSync(path.dirname(out), { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(base + pagePath, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(400)
  if (fullPage) {
    // The shell scrolls inside the page (h-dvh + overflow-auto); let the document grow instead.
    await page.addStyleTag({
      content:
        '.h-dvh{height:auto!important;min-height:100vh;overflow:visible!important}.overflow-auto{overflow:visible!important}',
    })
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: out, fullPage })
  console.log(`saved ${out} (${width}×${height}${fullPage ? ', full page' : ''})`)
  if (errors.length) {
    console.log(`console errors:\n${errors.map((e) => `  ${e}`).join('\n')}`)
  }
} finally {
  await browser.close()
}
