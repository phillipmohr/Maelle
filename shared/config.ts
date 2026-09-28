/**
 * Hardcoded configuration of Maelle for InstaRadar.
 *
 * Only secrets and per-environment values live in the environment (see .env.example: Supabase,
 * Stripe, the mailbox password, API tokens). Everything that identifies the setup and would
 * otherwise drift between environments is fixed here: who signs in, which mailbox, which Linear
 * team, which InstaRadar project and tables, which models, the tuning knobs.
 */

/** The single Maelle user. */
export const OWNER = {
  /** The only account allowed to sign in (Supabase Auth: magic link or Google). */
  email: 'phillip.mohr97@gmail.com',
  /** Alerts and the daily digest, unless `settings.notify_email` says otherwise. */
  notifyEmail: 'phillip.mohr97@gmail.com',
  timezone: 'Europe/Berlin',
} as const

/** The support mailbox: Namecheap Private Email, IMAP in, SMTP out. Login is the address. */
export const MAILBOX = {
  address: 'support@instaradar.app',
  fromName: 'InstaRadar Support',
  imap: { host: 'mail.privateemail.com', port: 993, secure: true },
  smtp: { host: 'mail.privateemail.com', port: 465, secure: true },
  /** Messages handled per fetch run. */
  fetchLimit: 50,
  /** How far back the first fetch of an empty cursor looks. */
  bootstrapDays: 1,
  markRead: false,
  /** A `sending` row older than this is treated as stuck and taken over. */
  stuckSendMinutes: 5,
  /** Appended to every outgoing reply when it is sent (the draft itself carries no sign-off). */
  signature: [
    'Best wishes,',
    'Anastasia',
    'Customer Care · InstaRadar',
    'support@instaradar.app',
    'https://www.instaradar.app',
    '',
    "I genuinely care that every customer leaves happy, so reach out anytime. I'm always glad to help. 🙂",
  ].join('\n'),
} as const

/** Linear team InstaRadar. */
export const LINEAR = {
  teamId: 'b706940b-cb6f-41cc-ae62-cc38a6a18592',
  teamKey: 'IRDR',
  teamName: 'InstaRadar',
} as const

/** The InstaRadar app: its Supabase project, its Vercel project and its database. */
export const INSTARADAR = {
  supabaseUrl: 'https://eqyprmmeatyvdvjtjwgf.supabase.co',
  vercel: { teamSlug: 'phillip-mohrs-projects', project: 'instaradar' },
  /**
   * Tables of the InstaRadar database, read from the project on 2026-09-28. `profile.id` is the
   * Supabase auth user id; plan and status live in `subscription`; tracked profiles carry the
   * Instagram handle in `instagram_username`, and every tracked_* and scan_* table cascades from
   * `tracked_profiles`.
   */
  db: {
    schema: 'public',
    profiles: 'profile',
    subscriptions: 'subscription',
    trackedProfiles: 'tracked_profiles',
    trackedHandleColumn: 'instagram_username',
    scanHistory: 'scan_history',
    notificationLog: 'notification_log',
    /** Added by the InstaRadar-side change in docs/instaradar (does not exist yet). */
    blockedProfiles: 'blocked_profiles',
    /**
     * Rows deleted for an account deletion, children first; the auth user is deleted afterwards
     * through the Auth admin API. `tracked_profiles` cascades to every tracked_*, scan_* and
     * activity table; `profile` cascades to `user_notification_settings`.
     */
    userTables: [
      { table: 'tracked_profiles', column: 'user_id' },
      { table: 'notification_log', column: 'user_id' },
      { table: 'manual_scan_requests', column: 'user_id' },
      { table: 'subscription', column: 'user_id' },
      { table: 'referrals', column: 'referee_user_id' },
      { table: 'profile', column: 'id' },
    ],
  },
} as const

/** Claude models. */
export const MODELS = {
  /** The agent run: research and drafting. */
  agent: 'claude-fable-5-1',
  /** Consistency check and the learning loop's condensations. */
  small: 'claude-sonnet-5',
} as const

/** Agent tuning. */
export const AGENT = {
  maxIterations: 16,
  sourceTimeoutMs: 20_000,
  knowledgeCacheTtlMs: 5 * 60_000,
} as const

/** Job runner budgets (Vercel function max duration is 300 s, see nuxt.config.ts). */
export const JOBS = {
  tickBudgetMs: 270_000,
  /** A long job (agent run) is claimed only while at least this much budget remains. */
  longJobReserveMs: 200_000,
  fetchLaneBudgetMs: 50_000,
} as const
