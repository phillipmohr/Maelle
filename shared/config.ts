/**
 * Hardcoded configuration of Maelle for InstaRadar.
 *
 * Only secrets and per-environment values live in the environment (see .env.example: Supabase,
 * Stripe, the mailbox password, API tokens). Everything that identifies the setup and would
 * otherwise drift between environments is fixed here: who signs in, which mailbox, which Linear
 * team, which InstaRadar project and tables, which models, the tuning knobs.
 */

/**
 * Maelle's own Supabase project. The URL and the publishable (anon) key are public by design (they
 * ship in the browser bundle); the service role key and the Postgres URL are secrets and stay in the
 * environment (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` or Vercel's `POSTGRES_URL`).
 */
export const SUPABASE = {
  url: 'https://gfvfugezaddciyvyamwx.supabase.co',
  anonKey: 'sb_publishable_YY6DIVvNX2GnzL7-gQiX2w_rfNrgr7e',
} as const

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
  fromName: 'Anastasia at InstaRadar',
  imap: { host: 'mail.privateemail.com', port: 993, secure: true },
  smtp: { host: 'mail.privateemail.com', port: 465, secure: true },
  /** Messages handled per fetch run. */
  fetchLimit: 50,
  /** How far back the first fetch of an empty cursor looks. */
  bootstrapDays: 1,
  markRead: false,
  /** A `sending` row older than this is treated as stuck and taken over. */
  stuckSendMinutes: 5,
  /**
   * History import ("Import history" in the inbox): the whole INBOX and the Sent folder, oldest
   * first, in chunks that fit next to the live fetch in the fetch-mail lane. Imported tickets are
   * closed on arrival, get no agent run, and are classified afterwards (MODELS.classify).
   */
  backfill: {
    /** Messages listed per chunk. */
    chunkLimit: 50,
    /** Wall-clock budget of one chunk (the fetch lane has 50 s in total). */
    chunkBudgetMs: 25_000,
    /** Imported tickets classified per chunk, and the budget of one chunk (tick lane). */
    classifyChunkLimit: 20,
    classifyChunkBudgetMs: 120_000,
    /** A ticket whose classification failed this often is left without a case. */
    classifyMaxAttempts: 3,
  },
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

/** Claude models (prices in shared/pricing.ts). */
export const MODELS = {
  /** The agent run: research and drafting, at AGENT.effort (IRDR-463). */
  agent: 'claude-sonnet-5-5',
  /** Consistency check and the learning loop's condensations, low effort. */
  small: 'claude-sonnet-5-5',
  /** Classify-only pass over imported history tickets (one short call per ticket, low effort). */
  classify: 'claude-sonnet-5-5',
} as const

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Agent tuning. */
export const AGENT = {
  maxIterations: 16,
  /** Thinking depth of the agent run (`output_config.effort`); the model default would be high. */
  effort: 'medium' as Effort,
  /**
   * From this research turn on, the tool results carry a nudge to submit with what is known unless
   * one specific fact is still missing. The hard stop stays `maxIterations`.
   */
  researchNudgeTurn: 4,
  sourceTimeoutMs: 20_000,
  knowledgeCacheTtlMs: 5 * 60_000,
  /**
   * A regenerate (trigger `rerun`) reads the Notion instructions at most this old, so a template or
   * protocol edit shows up in the next regenerated reply; a bulk regenerate shares one fetch.
   */
  rerunKnowledgeMaxAgeMs: 60_000,
} as const

/** Job runner budgets (Vercel function max duration is 300 s, see nuxt.config.ts). */
export const JOBS = {
  tickBudgetMs: 270_000,
  /** A long job (agent run) is claimed only while at least this much budget remains. */
  longJobReserveMs: 200_000,
  fetchLaneBudgetMs: 50_000,
} as const
