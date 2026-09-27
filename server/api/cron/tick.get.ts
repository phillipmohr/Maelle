/** GET /api/cron/tick — Vercel Cron invokes with GET; same handler as the POST route. */
export { tickHandler as default } from '../../jobs/http'
