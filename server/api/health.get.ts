import { isSupabaseConfigured } from '../utils/supabase'
import { isServiceRegistered } from '../utils/services'

export default defineEventHandler(() => ({
  ok: true,
  time: new Date().toISOString(),
  supabase: isSupabaseConfigured() ? 'configured' : 'missing',
  services: {
    jobs: isServiceRegistered('jobs') ? 'real' : 'stub',
    mail: isServiceRegistered('mail') ? 'real' : 'stub',
    agent: isServiceRegistered('agent') ? 'real' : 'stub',
    executor: isServiceRegistered('executor') ? 'real' : 'stub',
    autonomy: isServiceRegistered('autonomy') ? 'real' : 'stub',
    notify: isServiceRegistered('notify') ? 'real' : 'stub',
  },
}))
