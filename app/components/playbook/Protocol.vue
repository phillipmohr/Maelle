<script setup lang="ts">
/** The Customer Support protocol sections (Persona & Tone, Writing Principles, Rules, Actions). */
import type { PlaybookResponse } from '#shared/api'

defineProps<{ protocol: PlaybookResponse['protocol'] }>()
</script>

<template>
  <Panel>
    <PanelHeader title="Protocol" eyebrow meta="Customer Support" />
    <div class="divide-hairline">
      <PlaybookLinkRow v-for="p in protocol" :key="p.title" :href="p.url">{{
        p.title
      }}</PlaybookLinkRow>
    </div>
  </Panel>
</template>
