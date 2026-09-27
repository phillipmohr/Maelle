<script setup lang="ts">
/** Inline editor for an action's parameters: typed fields from the registry, validated with zod. */
import type { ActionType } from '#shared/actions'
import {
  coerceParam,
  paramFields,
  paramInputValue,
  paramsProblem,
  type ParamField,
} from '~/composables/useTicketParams'

const props = defineProps<{ type: ActionType; params: Record<string, unknown> }>()
const emit = defineEmits<{ 'update:params': [params: Record<string, unknown>] }>()

const fields = computed(() => paramFields(props.type))
const problem = computed(() => paramsProblem(props.type, props.params))

function set(field: ParamField, raw: string | boolean) {
  const value = coerceParam(field, raw)
  const next: Record<string, unknown> = Object.fromEntries(
    Object.entries(props.params).filter(([k]) => k !== field.key),
  )
  if (value !== undefined) next[field.key] = value
  emit('update:params', next)
}
function optionLabel(field: ParamField): string {
  const v = props.params[field.key]
  return field.options?.find((o) => o.value === v)?.label ?? 'Choose…'
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2 rounded-md border border-line bg-page/50 px-3 py-3">
    <p v-if="fields.length === 0" class="text-caption text-fg-muted">
      Nothing to edit here: the ids come from the research.
    </p>
    <div v-else class="grid grid-cols-2 gap-x-3 gap-y-2">
      <label
        v-for="f in fields"
        :key="f.key"
        class="flex flex-col gap-1 text-caption text-fg-muted"
        :class="
          f.kind === 'text' && (f.key === 'description' || f.key === 'comment') && 'col-span-2'
        "
      >
        {{ f.label }}
        <span
          v-if="f.kind === 'boolean'"
          class="flex h-[38px] items-center gap-2 text-small text-fg"
        >
          <Checkbox
            :model-value="Boolean(params[f.key] ?? true)"
            @update:model-value="(v) => set(f, Boolean(v))"
          />{{ params[f.key] === false ? 'No' : 'Yes' }}
        </span>
        <DropdownMenu v-else-if="f.kind === 'select'">
          <DropdownMenuTrigger
            class="flex h-[38px] w-full items-center justify-between rounded-md border border-line bg-inset px-3 text-left text-small text-fg outline-none hover:border-line-strong"
          >
            <span>{{ optionLabel(f) }}</span>
            <span
              class="size-[6px] rotate-45 border-b-[1.5px] border-r-[1.5px] border-sand"
              aria-hidden="true"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-[var(--reka-dropdown-menu-trigger-width)] min-w-[200px]">
            <DropdownMenuItem v-for="o in f.options" :key="o.value" @select="set(f, o.value)">{{
              o.label
            }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span v-else-if="f.kind === 'money'" class="relative">
          <span
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-caption text-fg-muted"
            >$</span
          >
          <Input
            type="number"
            class="pl-6 font-mono"
            :model-value="paramInputValue(f, params[f.key])"
            @update:model-value="(v) => set(f, v)"
          />
        </span>
        <Input
          v-else
          :type="
            f.kind === 'number'
              ? 'number'
              : f.kind === 'date'
                ? 'date'
                : f.kind === 'email'
                  ? 'email'
                  : 'text'
          "
          :placeholder="f.placeholder"
          :class="f.kind === 'number' || f.kind === 'date' || f.kind === 'email' ? 'font-mono' : ''"
          :model-value="paramInputValue(f, params[f.key])"
          @update:model-value="(v) => set(f, v)"
        />
      </label>
    </div>
    <p v-if="problem" class="font-mono text-[11.5px] text-brick">{{ problem }}</p>
  </div>
</template>
