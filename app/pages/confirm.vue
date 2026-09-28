<script setup lang="ts">
/** Auth callback. Waits for the session, checks the allow-list against the server, then continues. */
definePageMeta({ layout: 'blank' })

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const cookieName = useRuntimeConfig().public.supabase?.cookieName as string | undefined
const redirectCookie = useCookie(`${cookieName ?? 'sb'}-redirect-path`)
const status = ref<'waiting' | 'checking' | 'denied'>('waiting')

watch(
  user,
  async (u) => {
    if (!u) return
    status.value = 'checking'
    try {
      await $fetch('/api/me')
      const target = redirectCookie.value || '/anastasai'
      redirectCookie.value = null
      await navigateTo(target)
    } catch {
      status.value = 'denied'
      await supabase.auth.signOut()
      await navigateTo('/login?error=not_allowed')
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center lamp-bg">
    <div class="flex flex-col items-center gap-4 text-center">
      <Wordmark :size="40" />
      <p class="text-body text-fg-muted animate-pulse-soft">
        {{
          status === 'denied'
            ? 'Not allowed.'
            : status === 'checking'
              ? 'Checking your account…'
              : 'Signing you in…'
        }}
      </p>
    </div>
  </div>
</template>
