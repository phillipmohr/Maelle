/**
 * `pnpm eval`: the agent evals as a separate vitest project (same aliases as the main config, longer
 * timeouts). The plumbing suite runs in CI without credentials; the live suite runs only when
 * ANTHROPIC_API_KEY is set.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': r('../shared'),
      '~~': r('../'),
      '~': r('../app'),
      '@': r('../app'),
    },
  },
  test: {
    root: r('../'),
    globals: false,
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    exclude: ['node_modules', '.nuxt', '.output', '.claude/**'],
    testTimeout: 240_000,
    hookTimeout: 60_000,
    // Live runs share one process so the report table stays readable.
    fileParallelism: false,
  },
})
