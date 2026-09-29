<script setup lang="ts">
/**
 * Customer message: the latest inbound message open (collapsed with Expand when long), earlier
 * messages behind "Show N earlier", an English translation toggle for non-English messages.
 */
import type { MessageRow } from '#shared/api'
import { ageShort } from '~/utils/format'

const props = defineProps<{ messages: MessageRow[]; now: Date }>()

const PREVIEW_LIMIT = 220
const sorted = computed(() =>
  [...props.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
)
const latestIndex = computed(() => {
  for (let i = sorted.value.length - 1; i >= 0; i--)
    if (sorted.value[i]!.direction === 'in') return i
  return sorted.value.length - 1
})
const latest = computed(() => sorted.value[latestIndex.value] ?? null)
const earlier = computed(() => sorted.value.filter((_, i) => i !== latestIndex.value))

const expanded = ref(false)
const showEarlier = ref(false)
const showTranslation = ref<Record<string, boolean>>({})
const showQuoted = ref<Record<string, boolean>>({})
watch(latest, () => {
  expanded.value = false
  showEarlier.value = false
})

const meta = computed(() => {
  const m = latest.value
  if (!m) return ''
  const n = sorted.value.length
  const pos = latestIndex.value + 1
  const age = `${ageShort(m.receivedAt ?? m.createdAt, props.now)} ago`
  if (n === 1) return `${age} · 1 message`
  const ord = pos === 1 ? '1st' : pos === 2 ? '2nd' : pos === 3 ? '3rd' : `${pos}th`
  return `${age} · ${ord} message in thread`
})

function hasQuotedHistory(m: MessageRow): boolean {
  return Boolean(m.textStripped && m.textBody && m.textStripped.trim() !== m.textBody.trim())
}
function text(m: MessageRow): string {
  if (showTranslation.value[m.id] && m.translation) return m.translation
  if (m.textStripped && !showQuoted.value[m.id]) return m.textStripped
  return m.textBody || ''
}
function toggleQuoted(m: MessageRow) {
  showQuoted.value = { ...showQuoted.value, [m.id]: !showQuoted.value[m.id] }
}
function paragraphs(m: MessageRow): string[] {
  return text(m)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}
function preview(m: MessageRow): string {
  return text(m).replace(/\s+/g, ' ').trim()
}
function isLong(m: MessageRow): boolean {
  return preview(m).length > PREVIEW_LIMIT
}
function toggleTranslation(m: MessageRow) {
  showTranslation.value = { ...showTranslation.value, [m.id]: !showTranslation.value[m.id] }
}
</script>

<template>
  <section
    v-if="latest"
    class="flex flex-col gap-[10px]"
    aria-label="Customer message"
    data-nav-label="Message"
  >
    <div class="flex items-baseline justify-between gap-3">
      <Eyebrow as="h2">{{
        latest.direction === 'in' ? 'Customer message' : 'Last message'
      }}</Eyebrow>
      <span class="flex items-center gap-3">
        <button
          v-if="latest.translation"
          type="button"
          class="text-caption font-semibold text-fg-muted hover:text-fg"
          @click="toggleTranslation(latest)"
        >
          {{ showTranslation[latest.id] ? 'Show original' : 'Show English' }}
        </button>
        <button
          v-if="hasQuotedHistory(latest) && !showTranslation[latest.id]"
          type="button"
          class="text-caption font-semibold text-fg-muted hover:text-fg"
          @click="toggleQuoted(latest)"
        >
          {{ showQuoted[latest.id] ? 'Hide quoted history' : 'Show quoted history' }}
        </button>
        <Mono class="text-[11px]">{{ meta }}</Mono>
      </span>
    </div>

    <button
      v-if="isLong(latest) && !expanded"
      type="button"
      class="flex min-w-0 items-baseline justify-between gap-4 rounded-md border border-line bg-base px-[18px] py-4 text-left transition-fast hover:border-line-strong"
      @click="expanded = true"
    >
      <span class="min-w-0 truncate text-body leading-[1.6] text-fg">{{ preview(latest) }}</span>
      <span class="whitespace-nowrap text-caption font-semibold">Expand</span>
    </button>
    <div
      v-else
      class="flex flex-col gap-[10px] rounded-md border border-line bg-base px-[18px] py-4 text-body leading-[1.6]"
    >
      <p
        v-for="(p, i) in paragraphs(latest)"
        :key="i"
        class="whitespace-pre-line [text-wrap:pretty]"
      >
        {{ p }}
      </p>
      <button
        v-if="isLong(latest)"
        type="button"
        class="self-end text-caption font-semibold text-fg-muted hover:text-fg"
        @click="expanded = false"
      >
        Collapse
      </button>
    </div>

    <template v-if="earlier.length">
      <button
        type="button"
        class="self-start text-caption font-semibold text-fg-muted hover:text-fg"
        :aria-expanded="showEarlier ? 'true' : 'false'"
        @click="showEarlier = !showEarlier"
      >
        {{ showEarlier ? 'Hide' : 'Show' }} {{ earlier.length }} other
        {{ earlier.length === 1 ? 'message' : 'messages' }} in the thread
      </button>
      <div v-if="showEarlier" class="flex flex-col gap-[10px]">
        <div
          v-for="m in earlier"
          :key="m.id"
          class="flex flex-col gap-2 rounded-md border border-line bg-base px-[18px] py-4 text-body leading-[1.6]"
          :class="m.direction === 'out' && 'border-dashed'"
        >
          <div class="flex items-center justify-between gap-3">
            <Mono class="text-[11px]">{{
              m.direction === 'in' ? m.fromEmail : `support@instaradar.app → ${m.toEmails[0] ?? ''}`
            }}</Mono>
            <span class="flex items-center gap-3">
              <button
                v-if="m.translation"
                type="button"
                class="text-caption font-semibold text-fg-muted hover:text-fg"
                @click="toggleTranslation(m)"
              >
                {{ showTranslation[m.id] ? 'Show original' : 'Show English' }}
              </button>
              <button
                v-if="hasQuotedHistory(m) && !showTranslation[m.id]"
                type="button"
                class="text-caption font-semibold text-fg-muted hover:text-fg"
                @click="toggleQuoted(m)"
              >
                {{ showQuoted[m.id] ? 'Hide quoted history' : 'Show quoted history' }}
              </button>
              <Mono class="text-[11px]"
                >{{ ageShort(m.sentAt ?? m.receivedAt ?? m.createdAt, now) }} ago</Mono
              >
            </span>
          </div>
          <p
            v-for="(p, i) in paragraphs(m)"
            :key="i"
            class="whitespace-pre-line [text-wrap:pretty]"
          >
            {{ p }}
          </p>
        </div>
      </div>
    </template>
  </section>
</template>
