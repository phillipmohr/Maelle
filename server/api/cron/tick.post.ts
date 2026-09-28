/** POST /api/cron/tick — owner: IRDR-455. Recurring schedule + due jobs within the time budget. CRON_SECRET required. */
export { tickHandler as default } from '../../jobs/http'
