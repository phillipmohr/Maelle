import tailwindcss from '@tailwindcss/vite'

// Placeholders let `nuxt build`, `nuxt typecheck` and vitest run without a
// Supabase project. Real values come from .env (see .env.example).
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key-placeholder'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// Development only: explore the UI against seed data without a Supabase project. Never in production.
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production'
// Links in notification mails: a custom domain when set, else Vercel's production URL, else dev.
const SITE_URL =
  process.env.NUXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  ssr: true,

  modules: ['@nuxtjs/supabase', '@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  components: [
    // Design system primitives are used without a prefix: <Button>, <Panel>, <StatusPill> …
    { path: '~/components/ui', pathPrefix: false },
    // Everything else keeps its folder prefix: <ShellRail>, <InboxTable> …
    '~/components',
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  app: {
    head: {
      title: 'Maelle',
      htmlAttrs: { lang: 'en', class: 'dark' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#17110B' },
      ],
    },
  },

  typescript: {
    strict: true,
    // `pnpm typecheck` runs vue-tsc; keep the dev server fast.
    typeCheck: false,
  },

  eslint: {
    config: {
      stylistic: false,
    },
  },

  supabase: {
    url: SUPABASE_URL,
    key: SUPABASE_ANON_KEY,
    serviceKey: SUPABASE_SERVICE_ROLE_KEY,
    redirect: !AUTH_DISABLED,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      include: undefined,
      exclude: ['/login', '/confirm'],
      saveRedirectToCookie: true,
    },
    types: '~~/shared/types/database.ts',
  },

  runtimeConfig: {
    // Server-only. Every other secret is read from process.env by the module that owns it, and
    // everything that is not a secret is hardcoded in shared/config.ts.
    authDisabled: AUTH_DISABLED,
    cronSecret: process.env.CRON_SECRET || '',
    linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET || '',
    public: {
      siteUrl: SITE_URL,
      appName: 'Maelle',
    },
  },

  nitro: {
    // Vercel is detected automatically when deploying; local builds use node-server.
    experimental: {
      tasks: false,
    },
    // Cron lanes and agent runs need the long function budget (docs/adr/001-jobs.md). Fluid compute
    // allows 300 s on Hobby and Pro; raise to 800 on Pro if a tick regularly runs out of budget.
    vercel: {
      functions: {
        maxDuration: 300,
      },
    },
  },
})
