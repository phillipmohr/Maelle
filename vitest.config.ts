import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': r('./shared'),
      '~~': r('./'),
      '~': r('./app'),
      '@': r('./app'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'shared/**/*.test.ts',
      'server/**/*.test.ts',
      'app/**/*.test.ts',
    ],
    exclude: ['node_modules', '.nuxt', '.output', '.claude/**'],
    // Database tests run only when TEST_DATABASE_URL is set (pnpm test:db sets it).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
