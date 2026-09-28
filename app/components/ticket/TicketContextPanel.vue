<script setup lang="ts">
/**
 * Customer context: plan key-values (card in mono), Payments & refunds timeline (disputed charges
 * in brick, cancellations muted), tracked profiles, previous tickets (open on click), log errors
 * with counts or "None" / "Unavailable · …", tags.
 */
import type { CustomerContext } from '#shared/api'

defineProps<{ context: CustomerContext | null }>()
</script>

<template>
  <div v-if="context" class="grid auto-rows-max content-start gap-6 px-5 pb-7 pt-[22px]">
    <section class="flex flex-col gap-[10px]">
      <Eyebrow as="h2">{{ context.title }}</Eyebrow>
      <KeyValueList :items="context.plan" />
    </section>

    <section
      v-if="context.timeline.length"
      class="flex flex-col gap-3"
      aria-label="Payments and refunds"
    >
      <Eyebrow as="h2">Payments &amp; refunds</Eyebrow>
      <div class="relative flex flex-col">
        <span class="absolute bottom-2 left-1 top-2 w-px bg-line" aria-hidden="true" />
        <div
          v-for="(e, i) in context.timeline"
          :key="i"
          class="relative grid grid-cols-[9px_minmax(0,1fr)_auto] gap-[10px] py-[5px]"
        >
          <span
            class="mt-1 size-[9px] rounded-pill border-[1.5px] box-border"
            :class="
              e.kind === 'bad'
                ? 'border-brick bg-brick'
                : e.kind === 'muted'
                  ? 'border-sand bg-page'
                  : 'border-ivory bg-page'
            "
          />
          <div class="flex flex-col gap-px">
            <span
              class="text-small"
              :class="
                e.kind === 'bad' ? 'text-brick' : e.kind === 'muted' ? 'text-fg-muted' : 'text-fg'
              "
              >{{ e.label }}</span
            >
            <Mono class="text-[11px]">{{ e.date }}</Mono>
          </div>
          <Mono
            class="pt-px"
            :class="
              e.kind === 'bad' ? 'text-brick' : e.kind === 'muted' ? 'text-fg-muted' : 'text-fg'
            "
            >{{ e.amount ?? '' }}</Mono
          >
        </div>
      </div>
    </section>

    <section
      v-if="context.trackedProfiles.length"
      class="flex flex-col gap-2"
      aria-label="Tracked profiles"
    >
      <Eyebrow as="h2">Tracked profiles</Eyebrow>
      <div
        v-for="p in context.trackedProfiles"
        :key="p.handle"
        class="flex justify-between gap-[10px] text-small"
      >
        <Mono tone="primary">{{ p.handle }}</Mono
        ><span class="text-caption text-fg-muted">{{ p.meta }}</span>
      </div>
    </section>

    <section class="flex flex-col gap-2" aria-label="Previous tickets">
      <Eyebrow as="h2">Previous tickets</Eyebrow>
      <template v-if="context.previousTickets.length">
        <NuxtLink
          v-for="p in context.previousTickets"
          :key="p.id + p.title"
          :to="`/anastasai/t/${p.displayNumber}`"
          class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-[10px] text-small text-fg no-underline hover:no-underline"
        >
          <Mono>#{{ p.displayNumber }}</Mono
          ><span class="truncate">{{ p.title }}</span
          ><Mono class="text-[11px]">{{ p.date }}</Mono>
        </NuxtLink>
      </template>
      <span v-else class="text-small text-fg-muted">None</span>
    </section>

    <section class="flex flex-col gap-2" aria-label="Log errors">
      <Eyebrow as="h2">Log errors</Eyebrow>
      <div
        v-if="context.logErrors && context.logErrors.length"
        class="flex flex-col gap-[6px] rounded-md border border-line bg-base px-3 py-[10px]"
      >
        <div
          v-for="l in context.logErrors"
          :key="l.text"
          class="flex justify-between gap-2 font-mono text-[11px] leading-[1.45]"
        >
          <span class="text-fg">{{ l.text }}</span
          ><span class="shrink-0 text-fg-muted">×{{ l.count }}</span>
        </div>
      </div>
      <span v-else class="text-small text-fg-muted">{{ context.logErrorsNote ?? 'None' }}</span>
    </section>

    <section v-if="context.tags.length" class="flex flex-col gap-2" aria-label="Tags">
      <Eyebrow as="h2">Tags</Eyebrow>
      <div class="flex flex-wrap gap-[6px]">
        <Chip v-for="g in context.tags" :key="g" variant="tag">{{ g }}</Chip>
      </div>
    </section>
  </div>
  <div v-else class="px-5 pt-[22px]">
    <Eyebrow as="h2">Customer</Eyebrow>
    <p class="pt-2 text-small text-fg-muted">
      No customer context yet. It is built with the research.
    </p>
  </div>
</template>
