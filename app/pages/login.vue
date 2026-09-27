<script setup lang="ts">
/** Sign in: magic link or Google. Only ALLOWED_USER_EMAIL gets through (server + database trigger). */
definePageMeta({ layout: 'blank' })
useHead({ title: 'Sign in' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const route = useRoute()

const email = ref('')
const sent = ref(false)
const busy = ref(false)
const error = ref<string | null>(
  route.query.error === 'not_allowed' ? 'This account is not allowed to use Maelle.' : null,
)

watch(
  user,
  (u) => {
    if (u) navigateTo('/confirm')
  },
  { immediate: true },
)

const redirectTo = () => `${window.location.origin}/confirm`

async function sendLink() {
  error.value = null
  busy.value = true
  const { error: e } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
  })
  busy.value = false
  if (e) {
    error.value = /not allowed|Database error/i.test(e.message)
      ? 'This account is not allowed to use Maelle.'
      : e.message
    return
  }
  sent.value = true
}

async function google() {
  error.value = null
  const { error: e } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo() },
  })
  if (e) error.value = e.message
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center px-6 lamp-bg">
    <div class="flex w-[420px] flex-col gap-10">
      <Wordmark :size="64" tagline />
      <div class="flex flex-col gap-3">
        <Eyebrow tone="accent">AnastasAI</Eyebrow>
        <h1 class="type-heading">Sign in to your inbox.</h1>
        <p class="text-body text-fg-muted">
          One account. Anything else is turned away before it reaches the data.
        </p>
      </div>

      <Panel :padding="24" class="flex flex-col gap-4">
        <template v-if="sent">
          <StatusPill status="success">Link sent</StatusPill>
          <p class="text-body">
            Check <Mono chip>{{ email }}</Mono> for the sign-in link. It works once and expires in
            an hour.
          </p>
        </template>
        <form v-else class="flex flex-col gap-3" @submit.prevent="sendLink">
          <label class="flex flex-col gap-2 text-small text-fg-muted">
            Email
            <Input
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="you@instaradar.app"
              required
              autofocus
            />
          </label>
          <Button type="submit" :loading="busy" :disabled="!email">Send magic link</Button>
          <div class="flex items-center gap-3 py-1 text-caption text-fg-muted">
            <span class="h-px flex-1 bg-line" />or<span class="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" @click="google">Continue with Google</Button>
        </form>
        <p v-if="error" class="text-small text-brick">{{ error }}</p>
      </Panel>
    </div>
  </div>
</template>
