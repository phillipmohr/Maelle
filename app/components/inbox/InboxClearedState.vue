<script setup lang="ts">
/** Screen 3b: nothing needs a decision. The lamp stays on the empty place, parked tickets in one line. */
import type { ParkedGroup } from '~/composables/useInboxRows'

defineProps<{ groups: ParkedGroup[] }>()
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-line px-11 py-10 lamp-bg"
    aria-label="Needs decision"
  >
    <Eyebrow tone="accent" as="h2">Needs decision</Eyebrow>
    <p class="font-serif text-[40px] leading-[1.1] text-fg [text-wrap:pretty]">
      Nothing needs you right now.
    </p>
    <div v-if="groups.length" class="flex flex-wrap gap-6 text-small text-fg-muted">
      <span v-for="g in groups" :key="g.key" class="flex items-center gap-2">
        <RiskDot :kind="g.dot" /><span class="font-semibold text-fg">{{ g.name }}</span
        >{{ g.text }}
      </span>
    </div>
    <p v-else class="text-small text-fg-muted">
      AnastasAI keeps reading support@instaradar.app. New messages are researched and drafted before
      you come back.
    </p>
  </section>
</template>
