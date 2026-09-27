import tailwindcss from '@tailwindcss/vite'

// Placeholders let `nuxt build`, `nuxt typecheck` and vitest run without a
// Supabase project. Real values come from .env (see .env.example).
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key-placeholder'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// Development only: explore the UI against seed data without a Supabase project. Never in production.
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production'

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
    // server-only
    allowedUserEmail: process.env.ALLOWED_USER_EMAIL || '',
    authDisabled: AUTH_DISABLED,
    cronSecret: process.env.CRON_SECRET || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    supportMailbox: process.env.SUPPORT_MAILBOX || 'support@instaradar.app',
    stripeReadKey: process.env.STRIPE_READ_KEY || '',
    stripeWriteKey: process.env.STRIPE_WRITE_KEY || '',
    instaradarDbReadUrl: process.env.INSTARADAR_DB_READ_URL || '',
    instaradarDbWriteUrl: process.env.INSTARADAR_DB_WRITE_URL || '',
    vercelApiToken: process.env.VERCEL_API_TOKEN || '',
    vercelTeamId: process.env.VERCEL_TEAM_ID || '',
    vercelInstaradarProjectId: process.env.VERCEL_INSTARADAR_PROJECT_ID || '',
    notionReadToken: process.env.NOTION_READ_TOKEN || '',
    notionWriteToken: process.env.NOTION_WRITE_TOKEN || '',
    linearReadApiKey: process.env.LINEAR_READ_API_KEY || '',
    linearWriteApiKey: process.env.LINEAR_WRITE_API_KEY || '',
    linearTeamId: process.env.LINEAR_TEAM_ID || '',
    linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET || '',
    notifyEmail: process.env.NOTIFY_EMAIL || '',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      appName: 'Maelle',
    },
  },

  nitro: {
    // Vercel is detected automatically when deploying; local builds use node-server.
    experimental: {
      tasks: false,
    },
  },
})
