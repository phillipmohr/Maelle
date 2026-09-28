<script setup lang="ts">
/** Snooze: Tonight, Tomorrow 09:00, Next week, or a custom time. Not offered for safety tickets. */
import { useShortcuts } from '~/composables/useShortcuts'
import { clockTime, shortDate } from '~/utils/format'

const props = defineProps<{ now: Date }>()
const emit = defineEmits<{ pick: [until: Date] }>()
const open = defineModel<boolean>('open', { default: false })

function at(base: Date, h: number, m = 0): Date {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}
const presets = computed(() => {
  const now = props.now
  const list: { key: string; label: string; when: Date }[] = []
  const tonight = at(now, 20)
  if (tonight.getTime() > now.getTime() + 15 * 60_000)
    list.push({ key: 'tonight', label: 'Tonight', when: tonight })
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  list.push({ key: 'tomorrow', label: 'Tomorrow 09:00', when: at(tomorrow, 9) })
  // Next Monday, but at least two days away so it never doubles "Tomorrow".
  const nextWeek = new Date(now)
  const day = nextWeek.getDay()
  let ahead = (8 - day) % 7 || 7
  if (ahead < 2) ahead += 7
  nextWeek.setDate(nextWeek.getDate() + ahead)
  list.push({ key: 'nextweek', label: 'Next week', when: at(nextWeek, 9) })
  return list
})

const custom = ref('')
const customDate = computed(() => {
  if (!custom.value) return null
  const d = new Date(custom.value)
  return Number.isNaN(d.getTime()) || d.getTime() <= props.now.getTime() ? null : d
})

function pick(d: Date) {
  open.value = false
  emit('pick', d)
}
function describe(d: Date): string {
  return `${shortDate(d, props.now)} · ${clockTime(d)}`
}

const { register } = useShortcuts()
register([
  ...[0, 1, 2].map((i) => ({
    id: `ticket.snooze.preset${i}`,
    keys: String(i + 1),
    label: `Snooze · preset ${i + 1}`,
    group: 'Decision',
    scope: 'ticket',
    hidden: true,
    when: () => open.value && presets.value.length > i,
    handler: () => {
      const p = presets.value[i]
      if (p) pick(p.when)
    },
  })),
  {
    id: 'ticket.snooze.custom',
    keys: 'mod+enter',
    label: 'Snooze · custom time',
    group: 'Decision',
    scope: 'ticket',
    hidden: true,
    allowInInput: true,
    when: () => open.value && customDate.value != null,
    handler: () => customDate.value && pick(customDate.value),
  },
])
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :width="520">
      <DialogHeader>
        <Eyebrow tone="accent">Snooze</Eyebrow>
        <DialogTitle>When should this come back?</DialogTitle>
        <DialogDescription
          >It leaves the inbox until then and returns under Needs decision.</DialogDescription
        >
      </DialogHeader>
      <div class="mt-5 flex flex-col gap-2">
        <button
          v-for="(p, i) in presets"
          :key="p.key"
          type="button"
          class="flex items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left transition-fast hover:border-line-strong"
          @click="pick(p.when)"
        >
          <span class="flex flex-col gap-px">
            <span class="text-body font-semibold">{{ p.label }}</span>
            <Mono class="text-[11px]">{{ describe(p.when) }}</Mono>
          </span>
          <Kbd :keys="String(i + 1)" />
        </button>
        <div class="flex items-end gap-2 rounded-md border border-line px-4 py-3">
          <label class="flex flex-1 flex-col gap-1 text-caption text-fg-muted"
            >Custom
            <Input v-model="custom" type="datetime-local" class="font-mono" />
          </label>
          <Button
            variant="secondary"
            size="sm"
            kbd="⌘⏎"
            :disabled="!customDate"
            @click="customDate && pick(customDate)"
            >Snooze</Button
          >
        </div>
      </div>
      <DialogFooter>
        <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
