---
name: create-pr
description: Use this skill when the user says "looks good", "create PR", or asks to open a pull request. Covers the PR creation and merge flow into main and the worktree cleanup.
---

## Pull Requests

- Never create a PR without explicit instruction from me
- "Looks good" or "create PR" authorizes the **full flow**: create the feature → `main` PR **and** merge it into `main`. Don't pause for a second confirmation
- Feature → `main` PR: keep the body lean. A one-line summary + the Linear ticket link is enough — the commit message already tells the story. Do **not** put the full summary or test plan here
- CI (`.github/workflows/ci.yml`: lint, typecheck, tests, evals, db tests, build) must be green before merging. Run the same checks locally first: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`
- Anything a human must do outside the repo (Vercel env vars, Supabase dashboard, Notion/Linear/Stripe setup) goes into a short "Manual setup" checklist in the PR body, one checkbox per item, each prefixed with the Linear ticket ID. Example:
  - `- [ ] IRDR-460 — add NOTION_TOKEN to the Vercel project`
- Once the PR is merged, remove the local worktree as the final cleanup step — it's part of the same "looks good" flow, no extra confirmation needed:
  - Run from the main checkout (not from inside the worktree): `git worktree remove .claude/worktrees/<branch-name>`
  - If git refuses because the session is still inside the worktree, exit the session first (the user will be prompted to keep or remove on exit)
  - Leave the branch itself in place — only the worktree directory is removed
