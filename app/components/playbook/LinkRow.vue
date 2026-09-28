<script setup lang="ts">
/** A row that opens in Notion. Nothing is edited in Maelle. */
defineProps<{ href: string }>()
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noreferrer noopener"
    class="flex items-center justify-between gap-4 px-[18px] py-3 text-small text-fg no-underline transition-fast [transition-property:background-color] hover:bg-elevated/50 hover:no-underline"
  >
    <slot />
    <span class="shrink-0 text-caption text-fg-muted"><slot name="meta">Notion ↗</slot></span>
  </a>
</template>
