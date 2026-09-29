---
name: troubleshooting
description: Dev server troubleshooting
---

## Dev server troubleshooting

### Weird module / export errors after reinstalling node_modules

Symptom (any of):

- `The requested module '.../h3/dist/_entries/node.mjs' does not provide an export named '...'`
- Errors referencing files or export paths that don't exist in the currently installed package
- Server crashes only when accessing a page, but `pnpm install` reported no problems

Cause: a stale `.nuxt` / Vite cache (and sometimes a still-running old dev
process) pinned to the *previous* dependency layout. After a reinstall swaps a
package to a different version, the cache keeps importing the old,
now-nonexistent path. Your `pnpm install` is usually fine — the cache is the
problem.

Fix — the standard Nuxt reset:

```sh
# kill any old dev server first (lsof -ti tcp:3000 | xargs kill), then:
rm -rf .nuxt .output .nitro node_modules/.cache
pnpm dev
```

Before blaming a package, sanity-check it's actually the phantom it looks like:

```
find node_modules -path '*/<pkg>/package.json'   # how many versions installed?
ls node_modules/<pkg>/dist/                       # does the errored file exist?
```

If the errored file doesn't exist anywhere in `node_modules`, it's a stale cache — reset and move on.

### First page load is slow — not a hang

On a cold start Nitro builds and the **first** request to each route compiles
its page + component tree on-demand. A `curl` with a short timeout will look
like it hangs / returns 0 bytes. Wait it out; subsequent loads are fast.

### Use localhost, not 0.0.0.0

Open `http://localhost:3000/`, never `http://0.0.0.0:3000/`. `0.0.0.0` isn't a secure context and breaks WebCrypto / Supabase auth.

### Running without credentials

- `AUTH_DISABLED=true pnpm dev` runs the UI against the seed data served by the
  stubbed routes (only honoured in `nuxt dev`, never in production).
- Without `SUPABASE_DB_URL` an agent run fails fast with "Database is not
  configured" — that's expected, the agent writes to Maelle's tables.
- `MAIL_FAKE_DIR`, `EXECUTOR_USE_FAKES` and `EXECUTOR_SEED_FAKES` switch the
  mailbox and the executor's Stripe/Linear/InstaRadar clients to in-memory
  fakes (see `.env.example` and `README.md`).
