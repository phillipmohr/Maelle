/** POST /api/cron/fetch-mail — owner: IRDR-455. Fetches support@instaradar.app (fetch_mail lane). CRON_SECRET required. */
export { fetchMailHandler as default } from '../../jobs/http'
