<script setup lang="ts">
/**
 * Button. primary = ivory on ink (the one lit action), secondary = hairline outline,
 * ghost = text only. `kbd` shows the keyboard hint the way the design does.
 */
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'sm'
    disabled?: boolean
    loading?: boolean
    type?: 'button' | 'submit' | 'reset'
    to?: string
    kbd?: string
    class?: string
  }>(),
  { variant: 'primary', size: 'md', disabled: false, loading: false, type: 'button' },
)

const classes = computed(() =>
  cn(
    'inline-flex items-center gap-2 rounded-md font-sans font-semibold leading-[1.2] whitespace-nowrap select-none',
    'transition-fast [transition-property:filter,border-color,color,background-color]',
    'disabled:cursor-not-allowed disabled:opacity-45',
    props.size === 'sm' ? 'px-[14px] py-[7px] text-small' : 'text-body',
    props.variant === 'primary' &&
      'bg-primary text-on-primary border border-primary hover:not-disabled:[filter:var(--hover-brighten)]' +
        (props.size === 'sm' ? '' : ' px-[22px] py-[11px]'),
    props.variant === 'secondary' &&
      'bg-transparent text-fg border border-line hover:not-disabled:border-line-strong' +
        (props.size === 'sm' ? '' : ' px-[20px] py-[11px]'),
    props.variant === 'ghost' &&
      'bg-transparent text-fg-muted border border-transparent hover:not-disabled:text-fg' +
        (props.size === 'sm' ? '' : ' px-[20px] py-[11px]'),
    props.variant === 'danger' &&
      'bg-transparent text-brick border border-brick/33 hover:not-disabled:bg-brick/8' +
        (props.size === 'sm' ? '' : ' px-[20px] py-[11px]'),
    props.loading && 'cursor-progress',
    props.class,
  ),
)
</script>

<template>
  <NuxtLink v-if="to && !disabled" :to="to" :class="classes">
    <slot />
    <Kbd v-if="kbd" :keys="kbd" :tone="variant === 'primary' ? 'on-primary' : 'default'" />
  </NuxtLink>
  <button
    v-else
    :type="type"
    :disabled="disabled || loading"
    :class="classes"
    :aria-busy="loading || undefined"
  >
    <span
      v-if="loading"
      class="inline-block size-3 rounded-pill border-[1.5px] border-current border-r-transparent animate-spin"
      aria-hidden="true"
    />
    <slot />
    <Kbd v-if="kbd" :keys="kbd" :tone="variant === 'primary' ? 'on-primary' : 'default'" />
  </button>
</template>
