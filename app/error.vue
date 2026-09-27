<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
const handleError = () => clearError({ redirect: '/anastasai' })
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-page px-6 text-fg lamp-bg">
    <div class="flex w-[520px] flex-col gap-6">
      <Eyebrow tone="accent">{{ error.statusCode }}</Eyebrow>
      <h1 class="type-display">
        {{ error.statusCode === 404 ? 'Nothing here.' : 'Something went wrong.' }}
      </h1>
      <p class="text-subject text-fg-muted">{{ error.statusMessage || error.message }}</p>
      <div><Button @click="handleError">Back to the inbox</Button></div>
    </div>
  </div>
</template>
