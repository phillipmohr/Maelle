<script setup lang="ts">
/** Activity log. Owner: IRDR-459 (screen 2c). */
import type { ActivityResponse, ExecutedBy } from '#shared/api'
import type { ActivityEntry } from '~/components/activity/Row.vue'

useHead({ title: 'Activity log' })

const by = ref<ExecutedBy | 'all'>('all')
const irreversibleOnly = ref(false)
const PAGE = 100

const query = computed(() => ({
  by: by.value === 'all' ? undefined : by.value,
  irreversibleOnly: irreversibleOnly.value ? 'true' : undefined,
  limit: PAGE,
}))

const { data, status } = await useFetch<ActivityResponse>('/api/activity', {
  key: 'activity',
  query,
})

/** Pages after the first, appended by "Load more"; reset when the filters change. */
const more = ref<ActivityResponse[]>([])
const loadingMore = ref(false)
watch(query, () => (more.value = []))

const pages = computed(() => (data.value ? [data.value, ...more.value] : []))
const nextCursor = computed(() => pages.value.at(-1)?.nextCursor ?? null)

const entries = computed<ActivityEntry[]>(() =>
  pages.value
    .flatMap((p) => [
      ...p.items.map((item): ActivityEntry => ({
        kind: 'execution',
        at: item.createdAt,
        id: item.id,
        item,
      })),
      ...(p.settings ?? []).map((item): ActivityEntry => ({
        kind: 'settings',
        at: item.createdAt,
        id: `s-${item.id}`,
        item,
      })),
    ])
    .sort((a, b) => b.at.localeCompare(a.at)),
)

async function loadMore() {
  const cursor = nextCursor.value
  if (!cursor || loadingMore.value) return
  loadingMore.value = true
  try {
    more.value = [
      ...more.value,
      await $fetch<ActivityResponse>('/api/activity', { query: { ...query.value, cursor } }),
    ]
  } finally {
    loadingMore.value = false
  }
}

const exportHref = computed(() => {
  const params = new URLSearchParams()
  if (by.value !== 'all') params.set('by', by.value)
  if (irreversibleOnly.value) params.set('irreversibleOnly', 'true')
  const qs = params.toString()
  return `/api/activity/export.csv${qs ? `?${qs}` : ''}`
})
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-6 overflow-auto px-12 pb-12 pt-9">
    <div class="flex items-end justify-between gap-8">
      <div class="flex max-w-[640px] flex-col gap-[10px]">
        <h1 class="type-display">Activity log</h1>
        <p class="text-body text-fg-muted">
          Every action that ran, in order. Irreversible actions in ember.
        </p>
      </div>
      <ActivityToolbar
        v-model:by="by"
        v-model:irreversible-only="irreversibleOnly"
        :export-href="exportHref"
      />
    </div>

    <ActivityTable :entries="entries" :loading="status === 'pending'" />

    <div v-if="nextCursor" class="flex justify-center">
      <Button variant="secondary" size="sm" :loading="loadingMore" @click="loadMore"
        >Load more</Button
      >
    </div>
  </div>
</template>
