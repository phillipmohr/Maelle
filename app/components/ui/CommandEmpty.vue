<script setup lang="ts">
import { inject } from 'vue'
import { COMMAND_KEY } from '~/composables/commandContext'

const ctx = inject(COMMAND_KEY)!
</script>

<template>
  <div v-if="ctx.visibleCount.value === 0" class="px-3 py-6 text-center text-small text-fg-muted">
    <slot>Nothing matches.</slot>
  </div>
</template>
