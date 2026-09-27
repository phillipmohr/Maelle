<script setup lang="ts">
/** Autonomy page. Owner: IRDR-459 (screen 1h). Foundation placeholder with the shell in place. */
import type { AutonomyResponse } from '#shared/api'
import { caseShortLabel } from '#shared/case-types'
import { actionLabel } from '#shared/actions'

useHead({ title: 'Autonomy' })
const { data } = await useFetch<AutonomyResponse>('/api/autonomy', { key: 'autonomy' })
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <div class="flex items-end justify-between gap-8">
      <div class="flex max-w-[640px] flex-col gap-[10px]">
        <h1 class="type-display">Autonomy</h1>
        <p class="text-body text-fg-muted [text-wrap:pretty]">
          Hand off one case type at a time, based on its track record. The goal is full autonomy:
          move each case to Auto once its record earns it.
        </p>
      </div>
      <div
        v-if="data"
        class="flex items-center gap-4 rounded-lg border border-line bg-base py-3 pl-[18px] pr-[14px]"
      >
        <div class="flex flex-col gap-[2px]">
          <span class="flex items-center gap-2 text-small font-semibold"
            ><RiskDot :kind="data.settings.globalPause ? 'failed' : 'done'" />{{
              data.settings.globalPause ? 'Automation paused' : 'Automation running'
            }}</span
          >
          <span class="text-caption text-fg-muted"
            >{{ data.onAutoCount }} case type{{ data.onAutoCount === 1 ? '' : 's' }} on Auto ·
            {{ data.alwaysAskCount }} on Always ask</span
          >
        </div>
        <Button variant="secondary" size="sm">{{
          data.settings.globalPause ? 'Resume' : 'Pause all'
        }}</Button>
      </div>
    </div>

    <Panel v-if="data">
      <div
        class="grid grid-cols-[minmax(0,1.3fr)_290px_minmax(0,1fr)_300px] gap-5 border-b border-line px-5 py-3 type-eyebrow text-fg-muted"
      >
        <span>Case type</span><span>Last 30 tickets</span><span>Recommendation</span
        ><span>Mode</span>
      </div>
      <div class="divide-hairline">
        <div
          v-for="c in data.cases"
          :key="c.caseType"
          class="grid grid-cols-[minmax(0,1.3fr)_290px_minmax(0,1fr)_300px] items-center gap-5 px-5 py-[14px]"
        >
          <div class="flex flex-col gap-[2px]">
            <span class="text-body font-semibold">{{ caseShortLabel(c.caseType) }}</span>
            <span class="text-caption text-fg-muted">{{
              c.typicalActions.map(actionLabel).join(' · ')
            }}</span>
          </div>
          <div class="flex flex-col gap-[6px]">
            <div class="flex gap-[2px]">
              <span
                v-for="(k, i) in 30"
                :key="i"
                class="h-[14px] w-[5px] rounded-[1px]"
                :class="
                  c.ticks[i] === 'unchanged'
                    ? 'bg-sage'
                    : c.ticks[i] === 'edited'
                      ? 'bg-gilt'
                      : c.ticks[i] === 'rejected'
                        ? 'bg-brick'
                        : 'bg-umber-700'
                "
              />
            </div>
            <Mono class="text-[11px]"
              >{{ c.total }} tickets · {{ c.unchanged }} unchanged · {{ c.edited }} edited ·
              {{ c.rejected }} rejected</Mono
            >
          </div>
          <div
            class="flex items-center gap-[10px] text-small"
            :class="c.recommendationKind === 'ready' ? 'text-fg' : 'text-fg-muted'"
          >
            <span
              class="size-[7px] shrink-0 rotate-45"
              :class="c.recommendationKind === 'ready' ? 'bg-gilt' : 'bg-umber-700'"
            />{{ c.recommendation }}
          </div>
          <SegmentedControl
            :model-value="c.mode"
            :options="[
              { value: 'always_ask', label: 'Always ask' },
              { value: 'auto', label: 'Auto' },
            ]"
            aria-label="Mode"
          />
        </div>
      </div>
      <div class="border-t border-line px-5 py-3 text-small text-fg-muted">
        Full page with settings, locks and audit trail in IRDR-459.
      </div>
    </Panel>
  </div>
</template>
