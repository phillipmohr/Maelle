/** POST /api/cron/tick — owner: IRDR-455. Runs due jobs (wake_snoozed, waiting_follow_up, run_due_scheduled, daily_digest). CRON_SECRET required. */
import { notImplemented } from '../../utils/stubs'

export default defineEventHandler(() => notImplemented('IRDR-455', 'Job runner tick'))
