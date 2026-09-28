# InstaRadar app checks for the blocklist

Three places consult `public.blocked_profiles`. The snippets assume a Nuxt/Supabase app with a
server-side Supabase client; adapt names to the real code.

## Shared guard

```ts
// server/utils/blocklist.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase()
}

export async function isBlocked(db: SupabaseClient, handle: string): Promise<boolean> {
  const { data, error } = await db
    .from('blocked_profiles')
    .select('username')
    .eq('username', normalizeHandle(handle))
    .maybeSingle()
  if (error) throw error
  return data !== null
}
```

## 1. Adding a profile

```ts
// server/api/profiles/track.post.ts (or the equivalent server action)
const handle = normalizeHandle(body.username)
if (await isBlocked(serviceDb, handle)) {
  // Neutral wording: never reveal that a removal request exists.
  throw createError({
    statusCode: 422,
    statusMessage: 'This profile is not available on InstaRadar',
  })
}
```

The trigger in `blocked_profiles.sql` refuses the insert as well, so a forgotten code path cannot
re-add a blocked profile; the check above only makes the error message friendly.

## 2. Scanning

```ts
// scan worker: before fetching a profile
const blocked = new Set(
  (await serviceDb.from('blocked_profiles').select('username')).data?.map((r) => r.username) ?? [],
)
const due = tracked.filter((t) => !blocked.has(normalizeHandle(t.instagram_username)))
// Optional hygiene: remove tracking rows that slipped through.
await serviceDb
  .from('tracked_profiles')
  .delete()
  .in('instagram_username', [...blocked])
```

## 3. Displaying

Read every list or detail through `visible_tracked_profiles` (the view in `blocked_profiles.sql`)
instead of `tracked_profiles`, or add the join to the existing queries:

```sql
select t.* from tracked_profiles t
where t.user_id = auth.uid()
  and not exists (select 1 from blocked_profiles b where b.username = lower(t.instagram_username));
```

Stored snapshots, follower diffs and media of a blocked profile stay in the database (so the
executor's action stays reversible on the InstaRadar side by deleting the blocklist row) but are never
returned by search, profile pages, exports or notification emails.

## 4. What Maelle writes

For `remove_from_tracking` the executor runs, in one transaction on `INSTARADAR_DB_URL`:

```sql
insert into public.blocked_profiles (username, reason, source) values ($1, $2, 'Maelle ticket #4831')
  on conflict (username) do nothing;
delete from public.tracked_profiles where lower(instagram_username) = $1;
```

and records `{ handle, alreadyBlocked, trackingStopped }` in Maelle's `action_executions` row.
