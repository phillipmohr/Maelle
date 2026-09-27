import type { MeResponse } from '#shared/api'

export default defineEventHandler((event): MeResponse => {
  const s = event.context.session
  return { email: s?.email ?? '', authDisabled: s?.authDisabled ?? false }
})
