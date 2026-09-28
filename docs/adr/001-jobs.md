# ADR 001: Where cron and jobs run

Status: accepted, 2026-09-27 (IRDR-455). Owner: mail and jobs ticket.

## Context

Maelle needs two kinds of scheduled work: a fetch of support@instaradar.app every one to two
minutes, and a job runner that everything else uses (agent runs of one to three minutes, sending
replies exactly once, wake-up of snoozed tickets, follow-up timers, the daily digest). Volume is
about three tickets a day. The requirements, in order: no missed runs, no double side effects,
retries with backoff, dead-letter, visible run history, a maximum run duration that fits an agent
run, local testability. Cost is irrelevant.

The stack is fixed: Nuxt on Vercel, Supabase (Postgres, Storage, Auth). The agent, the executor and
the mail code are Node code inside the Nuxt server.

## Options

### A. Vercel Cron invoking the Nuxt server, queue in Maelle's Postgres (chosen)

`vercel.json` declares two crons that GET `/api/cron/tick` and `/api/cron/fetch-mail` every minute
with `Authorization: Bearer CRON_SECRET`. The tick evaluates the recurring schedule and runs due jobs
from a `jobs` table in Maelle's Supabase Postgres, claimed with `FOR UPDATE SKIP LOCKED`.

### B. Supabase pg_cron + pg_net calling the same endpoints

`cron.schedule('* * * * *', $$ select net.http_post(url := 'https://maelle.../api/cron/tick', headers := '{"Authorization": "Bearer ..."}') $$)`.
The queue stays in Postgres; only the trigger differs.

### C. Supabase Edge Functions doing the work

pg_cron schedules an Edge Function that fetches mail and runs jobs itself.

### D. Supabase Queues (pgmq) instead of our own jobs table

Durable queue with visibility timeouts, read/archive semantics, driven by pg_cron or by the app.

### E. A hosted job service (Inngest, Trigger.dev, QStash)

Durable execution and retries as a service, calling back into the app.

## Evaluation

| Criterion                     | A: Vercel Cron + Postgres queue                                                                                                                                                                 | B: pg_cron + pg_net                                                                                                                                                    | C: Edge Functions                                                                                                                                | D: Supabase Queues                                                          | E: Hosted service                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| No missed runs                | Delivery is best effort (Vercel documents occasional missed and duplicate invocations). Mitigated: the schedule is evaluated from `job_heartbeats` on every tick, so the next tick catches up.  | pg_cron is reliable within the database, but pg_net has no retries and a short request timeout; a missed HTTP call is only caught up by our own schedule logic anyway. | Same as B for the trigger. Function itself reliable.                                                                                             | Queue is durable; the consumer still needs a trigger (A or B).              | Very good, but a third system holds schedule state.       |
| No double side effects        | `SKIP LOCKED` claims, atomic slot claims per recurring job, dedupe keys, Message-ID dedupe, `mail_sends` idempotency. Concurrent cron invocations are safe by design.                           | Same protections (they live in the queue, not in the trigger).                                                                                                         | Same, if the code is ported.                                                                                                                     | Visibility timeout gives at-least-once; idempotency still ours.             | At-least-once; idempotency still ours.                    |
| Retries, backoff, dead-letter | In the `jobs` table: attempts, exponential backoff with jitter, `dead` status with alert.                                                                                                       | Same table.                                                                                                                                                            | Would have to be rebuilt in Deno.                                                                                                                | pgmq has no backoff or dead-letter of its own; we would add a table anyway. | Built in.                                                 |
| Visible run history           | `jobs`, `job_runs` (one row per attempt), `job_heartbeats`, `mail_cursors.last_result`, `mail_sends`. Vercel keeps invocation logs too.                                                         | Same tables, plus `cron.job_run_details`.                                                                                                                              | Supabase function logs.                                                                                                                          | pgmq archive table.                                                         | Vendor dashboard.                                         |
| Max run duration              | Vercel Function `maxDuration`: 300 s by default with Fluid compute (up to 800 s on Pro). An agent run of 1 to 3 min fits; the tick claims long jobs only while at least 200 s of budget remain. | pg_net waits at most a few seconds for the response; it can start a function but cannot observe a 3 minute run. Fine as a trigger only.                                | 150 s wall clock on the free plan, 400 s on paid; and the code would live in a second runtime (Deno), duplicating agent, executor and mail code. | n/a (queue only).                                                           | Generous, but the work still runs in our Vercel function. |
| Local testability             | HTTP routes plus a plain Postgres: `pnpm test:db` runs the whole pipeline on a local Postgres, `curl` triggers a tick against `pnpm dev`.                                                       | Needs the Supabase CLI Docker stack for pg_cron/pg_net locally.                                                                                                        | Needs the Supabase CLI stack and Deno.                                                                                                           | Needs the pgmq extension locally.                                           | Needs the vendor's dev server or tunnel.                  |
| Granularity                   | Per minute on Pro and Enterprise; Hobby allows only daily crons (deployment fails otherwise).                                                                                                   | Per minute (and seconds) on every Supabase plan.                                                                                                                       | Per minute.                                                                                                                                      | n/a                                                                         | Per minute.                                               |
| Moving parts                  | One app, one database. Nothing new to operate.                                                                                                                                                  | Two extensions and an outbound HTTP path from the database.                                                                                                            | A second runtime and codebase.                                                                                                                   | One extension, semantics we do not control.                                 | A third vendor holding schedule state.                    |

## Decision

Option A. The queue and the schedule state live in Maelle's own Postgres; Vercel Cron is only a
metronome. Everything that matters for correctness is enforced in the database, so the metronome
may be late, may fire twice, or may be replaced without changing semantics:

- `jobs` (id, type, payload, status queued|running|succeeded|failed|dead, run_at, attempts,
  max_attempts, lock_ttl_seconds, last_error, locked_at, locked_by, dedupe_key unique, ...),
  `job_runs` (one row per attempt, incl. `expired` and `skipped`), `job_heartbeats` (per recurring
  job: last claimed slot, last start/success/failure, consecutive failures, last alert).
- Claim: `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`. A running job whose
  `locked_at` is older than its `lock_ttl_seconds` (agent runs: 10 minutes) was killed; the next
  tick re-queues it (attempt counted) or dead-letters it, and marks the old run `expired`.
- Retries: exponential backoff with 20 % jitter; `agent_run` 4 attempts (1, 2, 4 min), sends 5
  attempts, then `dead` plus `notify('system_alert')`. Recurring jobs (fetch_mail, wake_snoozed,
  waiting_follow_up, run_due_scheduled, daily_digest) are never dead-lettered: their instance ends
  `failed`, the heartbeat counts consecutive failures, and the schedule fires the next run.
- Recurring schedule: each tick computes the slot of every recurring job (minute bucket, or the local
  date for the digest at `settings.digest_time` in `settings.timezone`) and claims it atomically in
  `job_heartbeats`. A slot is claimed once (never doubled); a late tick still claims a slot that has
  not been claimed (never missed); at most one instance of a recurring job is pending at a time, so
  a missing handler never piles up jobs.
- Idempotent enqueue through `dedupe_key`, e.g. `agent_run:{ticketId}:{trigger}:{messageId}`.
- A job whose handler is not registered (another ticket's plugin not deployed yet) is released
  with a 60 s delay without counting an attempt and logged, never dropped and never crashing.
- Two lanes: `/api/cron/tick` (schedule + all jobs, budget `JOBS.tickBudgetMs` in `shared/config.ts`, 270 s,
  long jobs only while `JOBS.longJobReserveMs` remains) and `/api/cron/fetch-mail` (fetch_mail
  only, one job, 50 s), so a three minute agent run never delays inbound mail. Both routes exist
  as GET (what Vercel Cron sends) and POST (the binding route table).
- Health: `notify('system_alert')` when fetch_mail fails three times in a row (and every 60 after),
  when no fetch succeeded for 15 minutes (at most once per hour), when a job is dead-lettered, and
  when a bounce refers to one of our replies.
- Retention: succeeded jobs 7 days, dead and failed 30 days, ignored mail 90 days, pruned once a day.

Option B stays available as a drop-in trigger if Vercel Cron is not possible (Hobby plan) or proves
unreliable: the routes accept the same `Authorization: Bearer CRON_SECRET` from anywhere.

```sql
-- Supabase SQL editor, only if Vercel Cron cannot be used:
create extension if not exists pg_cron; create extension if not exists pg_net;
select cron.schedule('maelle-tick', '* * * * *', $$
  select net.http_get('https://<maelle-host>/api/cron/tick',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb) $$);
select cron.schedule('maelle-fetch-mail', '* * * * *', $$
  select net.http_get('https://<maelle-host>/api/cron/fetch-mail',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb) $$);
```

## Consequences

- The Vercel project needs the Pro plan for per-minute crons (Hobby allows daily crons only) and a
  function max duration of 300 s for the cron routes. Nitro 2.13 exposes this as
  `nitro.vercel.functions.maxDuration` in `nuxt.config.ts` (owned by the foundation ticket) or via
  the project's function settings in the Vercel dashboard. `JOBS.tickBudgetMs` must stay below it.
- Vercel does not retry a failed cron invocation; our state machine makes that unnecessary.
- Because the cron functions may overlap (a tick running into the next minute), every job handler
  must be idempotent. The runner guarantees a job is not handed to two workers while a lock is fresh,
  and never runs two `agent_run` jobs for the same ticket at once.
- Everything is testable on a plain Postgres: `pnpm test:db` runs the claim, retry, dead-letter,
  expired-lock, schedule, timer, inbound, outbound and webhook paths against the real migrations.
