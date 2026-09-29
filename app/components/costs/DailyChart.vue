<script setup lang="ts">
/**
 * Cost per day as one series of thin columns (gilt on the base surface), hairline gridlines, the
 * peak labeled, a tooltip on every bar and a table view. Inline SVG sized to its container.
 */
import { useElementSize } from '@vueuse/core'
import type { UsageDay } from '#shared/api'
import { totalInputTokens } from '#shared/usage'
import { formatCost, formatTokens, plural, shortDate } from '~/utils/format'

const props = defineProps<{ series: UsageDay[]; days: number }>()

const host = ref<HTMLElement | null>(null)
const { width } = useElementSize(host)
const H = 180
const PAD = { top: 18, right: 8, bottom: 22, left: 44 }
const now = new Date()

const active = ref<number | null>(null)
const tableOpen = ref(false)

const values = computed(() => props.series.map((d) => d.costUsd ?? 0))
const max = computed(() => Math.max(0, ...values.value))
const peak = computed(() => {
  const m = max.value
  if (m <= 0) return -1
  return values.value.indexOf(m)
})

/** Clean tick steps: 1, 2, 5 × 10^n so the axis reads 0 / 0.5 / 1.0 rather than 0 / 0.37 / 0.74. */
function niceMax(m: number): number {
  if (m <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(m))
  for (const f of [1, 2, 2.5, 5, 10]) if (m <= f * pow) return f * pow
  return 10 * pow
}
const top = computed(() => niceMax(max.value))
const ticks = computed(() => [0, top.value / 2, top.value])

const layout = computed(() => {
  const w = Math.max(0, width.value)
  const plotW = Math.max(0, w - PAD.left - PAD.right)
  const plotH = H - PAD.top - PAD.bottom
  const n = Math.max(1, props.series.length)
  const band = plotW / n
  const bar = Math.min(24, Math.max(2, band - 2))
  const y = (v: number) => PAD.top + plotH - (top.value > 0 ? (v / top.value) * plotH : 0)
  return {
    w,
    plotW,
    plotH,
    band,
    bar,
    baseline: PAD.top + plotH,
    bars: props.series.map((d, i) => {
      const v = d.costUsd ?? 0
      const x = PAD.left + i * band + (band - bar) / 2
      const yTop = y(v)
      const h = Math.max(0, PAD.top + plotH - yTop)
      return { i, d, v, x, y: yTop, h, cx: x + bar / 2 }
    }),
    y,
  }
})

/** A column with a 4px rounded cap and a square base. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

const xLabels = computed(() => {
  const n = props.series.length
  if (n === 0) return []
  const every = n > 45 ? 14 : n > 10 ? 7 : 1
  return props.series
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => i === 0 || i === n - 1 || (i % every === 0 && i < n - 3))
})

function dateLabel(date: string): string {
  return shortDate(new Date(`${date}T12:00:00`), now)
}

const total = computed(() => props.series.reduce((a, d) => a + (d.costUsd ?? 0), 0))
const empty = computed(() => props.series.every((d) => d.calls === 0))
</script>

<template>
  <Panel>
    <PanelHeader
      title="Cost per day"
      eyebrow
      :meta="empty ? 'no calls in this window' : `${formatCost(total)} in ${plural(days, 'day')}`"
    >
      <button
        v-if="!empty"
        type="button"
        class="ml-4 text-caption font-semibold text-fg-muted hover:text-fg"
        :aria-expanded="tableOpen ? 'true' : 'false'"
        @click="tableOpen = !tableOpen"
      >
        {{ tableOpen ? 'Hide table' : 'Show table' }}
      </button>
    </PanelHeader>
    <div ref="host" class="relative px-3 pb-2 pt-3">
      <svg
        v-if="layout.w > 0"
        :width="layout.w"
        :height="H"
        :viewBox="`0 0 ${layout.w} ${H}`"
        role="img"
        :aria-label="`Cost per day, ${plural(days, 'day')}`"
        class="block overflow-visible font-mono text-[10.5px]"
        @pointerleave="active = null"
      >
        <g v-for="t in ticks" :key="t">
          <line
            :x1="PAD.left"
            :x2="layout.w - PAD.right"
            :y1="layout.y(t)"
            :y2="layout.y(t)"
            class="stroke-line"
            stroke-width="1"
          />
          <text :x="PAD.left - 8" :y="layout.y(t) + 3.5" text-anchor="end" class="fill-fg-muted">
            {{ t === 0 ? '0' : formatCost(t) }}
          </text>
        </g>
        <g v-for="b in layout.bars" :key="b.i">
          <rect
            :x="PAD.left + b.i * layout.band"
            :y="PAD.top"
            :width="layout.band"
            :height="layout.plotH"
            fill="transparent"
            tabindex="0"
            :aria-label="`${dateLabel(b.d.date)}: ${formatCost(b.d.costUsd)}, ${plural(b.d.calls, 'call')}`"
            class="outline-none"
            @pointerenter="active = b.i"
            @focus="active = b.i"
            @blur="active = null"
          />
          <path
            :d="barPath(b.x, b.y, layout.bar, b.h)"
            :class="active === b.i ? 'fill-ivory' : 'fill-gilt'"
            class="pointer-events-none transition-fast [transition-property:fill]"
          />
          <text
            v-if="b.i === peak && active !== b.i"
            :x="b.cx"
            :y="b.y - 6"
            text-anchor="middle"
            class="pointer-events-none fill-fg"
          >
            {{ formatCost(b.v) }}
          </text>
        </g>
        <line
          :x1="PAD.left"
          :x2="layout.w - PAD.right"
          :y1="layout.baseline"
          :y2="layout.baseline"
          class="stroke-line-strong"
          stroke-width="1"
        />
        <text
          v-for="l in xLabels"
          :key="l.i"
          :x="PAD.left + l.i * layout.band + layout.band / 2"
          :y="H - 6"
          :text-anchor="l.i === 0 ? 'start' : l.i === series.length - 1 ? 'end' : 'middle'"
          class="fill-fg-muted"
        >
          {{ dateLabel(l.d.date) }}
        </text>
      </svg>
      <div
        v-if="active !== null && layout.bars[active]"
        class="pointer-events-none absolute z-10 flex min-w-[150px] flex-col gap-[2px] rounded-sm border border-line bg-elevated px-[10px] py-[7px] shadow-lamp"
        :style="{
          left: `${
            layout.bars[active]!.cx + 14 + 150 > layout.w
              ? layout.bars[active]!.cx - 14 - 150
              : layout.bars[active]!.cx + 14
          }px`,
          top: `${Math.max(0, Math.min(layout.bars[active]!.y - 8, layout.baseline - 70))}px`,
        }"
        role="status"
      >
        <span class="font-sans text-small font-semibold text-fg">{{
          formatCost(layout.bars[active]!.d.costUsd)
        }}</span>
        <span class="font-mono text-[11px] text-fg-muted">{{
          dateLabel(layout.bars[active]!.d.date)
        }}</span>
        <span class="font-mono text-[11px] text-fg-muted"
          >{{ plural(layout.bars[active]!.d.calls, 'call') }} ·
          {{ plural(layout.bars[active]!.d.tickets, 'ticket') }} ·
          {{
            formatTokens(
              totalInputTokens(layout.bars[active]!.d) + layout.bars[active]!.d.outputTokens,
              { compact: true },
            )
          }}
          tokens</span
        >
      </div>
    </div>
    <div v-if="tableOpen" class="border-t border-line">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead class="text-right">Calls</TableHead>
            <TableHead class="text-right">Tickets</TableHead>
            <TableHead class="text-right">Tokens in</TableHead>
            <TableHead class="text-right">Out</TableHead>
            <TableHead class="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="d in [...series].reverse().filter((x) => x.calls > 0)" :key="d.date">
            <TableCell>{{ dateLabel(d.date) }}</TableCell>
            <TableCell mono class="text-right">{{ d.calls }}</TableCell>
            <TableCell mono class="text-right">{{ d.tickets }}</TableCell>
            <TableCell mono class="text-right">{{ formatTokens(totalInputTokens(d)) }}</TableCell>
            <TableCell mono class="text-right">{{ formatTokens(d.outputTokens) }}</TableCell>
            <TableCell mono class="text-right text-fg">{{ formatCost(d.costUsd) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </Panel>
</template>
