<script setup lang="ts">
/**
 * SourceChip: "Stripe · sub_1PzT8c", "Knowledge base · Refund policy". Mono, hairline, 11px.
 * With `href` it opens the source (Stripe, Notion, Linear) in a new tab; with `to` it navigates.
 */
import { cn } from '~/utils/cn'

const props = defineProps<{
  href?: string | null
  to?: string | null
  class?: string
}>()
</script>

<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noreferrer noopener"
    :class="
      cn(
        'inline-flex items-center rounded-xs border border-line px-[6px] py-px font-mono text-[11px] text-fg-muted no-underline hover:border-line-strong hover:text-fg hover:no-underline',
        props.class,
      )
    "
  >
    <slot />
  </a>
  <NuxtLink
    v-else-if="to"
    :to="to"
    :class="
      cn(
        'inline-flex items-center rounded-xs border border-line px-[6px] py-px font-mono text-[11px] text-fg-muted no-underline hover:border-line-strong hover:text-fg hover:no-underline',
        props.class,
      )
    "
  >
    <slot />
  </NuxtLink>
  <span
    v-else
    :class="
      cn(
        'inline-flex items-center rounded-xs border border-line px-[6px] py-px font-mono text-[11px] text-fg-muted',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
