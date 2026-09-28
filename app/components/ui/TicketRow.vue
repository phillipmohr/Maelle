<script setup lang="ts">
/**
 * TicketRow for the inbox list: risk dot · name · time, subline "Case · summary · N actions",
 * optional live research checklist line and a tag ("Retry or mark done", "Returned from waiting").
 * Selected rows sit on the elevated surface. Keyboard: the row is a link or a button.
 */
import { cn } from '~/utils/cn'
import type { RiskDotKind } from './RiskDot.vue'

const props = withDefaults(
  defineProps<{
    name: string
    time: string
    sub?: string
    risk?: RiskDotKind
    research?: string | null
    tag?: string | null
    tagTone?: 'brick' | 'slate-blue' | 'ember' | 'sage' | 'sand'
    selected?: boolean
    to?: string
    class?: string
  }>(),
  { risk: 'none', selected: false, tagTone: 'brick', research: null, tag: null, sub: '' },
)

const emit = defineEmits<{ select: [] }>()
const NuxtLink = resolveComponent('NuxtLink')
</script>

<template>
  <component
    :is="to ? NuxtLink : 'button'"
    :to="to"
    :type="to ? undefined : 'button'"
    :aria-current="selected ? 'true' : undefined"
    :class="
      cn(
        'grid w-full grid-cols-[10px_minmax(0,1fr)_auto] gap-x-3 gap-y-[3px] border-t border-line px-[18px] py-[11px] text-left no-underline hover:no-underline',
        'transition-fast [transition-property:background-color] hover:bg-elevated/50 focus-visible:outline-offset-[-2px]',
        selected && 'bg-elevated hover:bg-elevated',
        props.class,
      )
    "
    @click="emit('select')"
  >
    <RiskDot :kind="risk" class="mt-[6px]" />
    <span
      :class="
        cn(
          'truncate text-[13.5px] font-semibold',
          risk === 'research' ? 'text-fg-muted' : 'text-fg',
        )
      "
      >{{ name }}</span
    >
    <span class="pt-[2px] font-mono text-[11px] text-fg-muted">{{ time }}</span>
    <span
      v-if="sub"
      class="col-start-2 col-end-4 truncate text-caption leading-[1.4] text-fg-muted"
      >{{ sub }}</span
    >
    <span v-if="research" class="col-start-2 col-end-4 font-mono text-[11px] text-fg-muted">{{
      research
    }}</span>
    <span
      v-if="tag"
      :class="
        cn(
          'col-start-2 col-end-4 text-[11px] font-semibold tracking-[0.02em]',
          {
            brick: 'text-brick',
            'slate-blue': 'text-slate-blue',
            ember: 'text-ember',
            sage: 'text-sage',
            sand: 'text-sand',
          }[tagTone],
        )
      "
      >{{ tag }}</span
    >
  </component>
</template>
