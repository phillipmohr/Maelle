/** GET /api/cron/fetch-mail — Vercel Cron invokes with GET; same handler as the POST route. */
export { fetchMailHandler as default } from '../../jobs/http'
