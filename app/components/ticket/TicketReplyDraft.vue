<script setup lang="ts">
/**
 * Reply draft: template name (opens Notion), "support@instaradar.app → customer", Edit (E) that
 * turns the body into an editor (⌘⏎ approves), the 3-dot menu (Regenerate reply: the agent drafts it
 * again, e.g. after a template or a setting changed), attachments, and the check line (held reason
 * or the consistency warnings after edits).
 */
import type { ConsistencyCheckResponse } from '#shared/api'
import { notionPageUrl } from '#shared/case-types'
import { MAILBOX } from '#shared/config'
import type { ReplyDraft } from '#shared/proposal'

const signature = MAILBOX.signature

const props = defineProps<{
  reply: ReplyDraft
  editing: boolean
  editable: boolean
  /** The draft is unsent and can be drafted again. */
  regenerable: boolean
  dirty: boolean
  /** Why the reply is not sent (e.g. held until a required action succeeds). */
  held: string | null
  mismatches: ConsistencyCheckResponse['mismatches']
}>()
const emit = defineEmits<{ toggleEdit: [force?: boolean]; discard: []; regenerate: [] }>()
const body = defineModel<string>('body', { required: true })
const subject = defineModel<string>('subject', { required: true })

const paragraphs = computed(() =>
  body.value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean),
)
const templateUrl = computed(() =>
  props.reply.templateNotionPageId ? notionPageUrl(props.reply.templateNotionPageId) : null,
)
const check = computed<{ tone: 'ember' | 'brick' | 'sage'; text: string } | null>(() => {
  if (props.held) return { tone: 'ember', text: props.held }
  if (props.mismatches.length > 0) {
    const worst = props.mismatches.find((m) => m.severity === 'error') ?? props.mismatches[0]!
    return { tone: worst.severity === 'error' ? 'brick' : 'ember', text: worst.text }
  }
  if (props.dirty)
    return { tone: 'sage', text: 'Edited by you · the actions still match the reply' }
  return null
})
const editor = ref<{ $el?: HTMLTextAreaElement } | HTMLTextAreaElement | null>(null)
watch(
  () => props.editing,
  async (on) => {
    if (!on) return
    await nextTick()
    const el =
      (editor.value as { $el?: HTMLTextAreaElement } | null)?.$el ??
      (editor.value as HTMLTextAreaElement | null)
    el?.focus?.()
  },
)
</script>

<template>
  <section class="flex flex-col gap-[10px]" aria-label="Reply draft" data-nav-label="Reply">
    <div class="flex items-baseline justify-between gap-3">
      <Eyebrow as="h2">Reply draft</Eyebrow>
      <Mono class="text-[11px]"
        >Template ·
        <a
          v-if="templateUrl"
          :href="templateUrl"
          target="_blank"
          rel="noreferrer noopener"
          class="text-fg-muted hover:text-fg"
          >{{ reply.template ?? 'from the protocol' }}</a
        ><template v-else>{{ reply.template ?? 'from the protocol' }}</template></Mono
      >
    </div>
    <div
      class="flex flex-col overflow-hidden rounded-md border bg-base"
      :class="editing ? 'border-line-strong' : 'border-line'"
    >
      <div
        class="flex items-center justify-between gap-3 border-b border-line px-[18px] py-[10px] font-mono text-[11px] text-fg-muted"
      >
        <span class="truncate">support@instaradar.app → {{ reply.to }}</span>
        <span v-if="editing" class="flex items-center gap-3">
          <span class="hidden items-center gap-[6px] sm:flex">Approve <Kbd keys="⌘⏎" /></span>
          <button type="button" class="text-fg-muted hover:text-fg" @click="emit('discard')">
            Discard
          </button>
          <button
            type="button"
            class="flex items-center gap-[6px] text-fg hover:text-fg"
            @click="emit('toggleEdit', false)"
          >
            Done <Kbd keys="Esc" />
          </button>
        </span>
        <span v-else class="flex items-center gap-2">
          <button
            v-if="editable"
            type="button"
            class="flex items-center gap-[6px] text-fg-muted hover:text-fg"
            @click="emit('toggleEdit', true)"
          >
            Edit <Kbd keys="E" />
          </button>
          <MoreMenu label="Reply options" :disabled="!regenerable">
            <DropdownMenuItem
              :description="
                dirty
                  ? 'Drafts it again with the current templates and settings · your edits are dropped'
                  : 'Drafts it again with the current templates and settings'
              "
              @select="emit('regenerate')"
              >Regenerate reply</DropdownMenuItem
            >
          </MoreMenu>
        </span>
      </div>
      <div v-if="editing" class="flex flex-col gap-3 px-[18px] pb-[18px] pt-4">
        <label class="flex flex-col gap-1 text-caption text-fg-muted">
          Subject
          <Input v-model="subject" />
        </label>
        <Textarea
          ref="editor"
          v-model="body"
          :rows="Math.max(8, Math.min(24, body.split('\n').length + 2))"
          aria-label="Reply body"
        />
      </div>
      <div v-else class="flex flex-col gap-3 px-[18px] pb-[18px] pt-4 text-body leading-[1.6]">
        <p v-for="(p, i) in paragraphs" :key="i" class="whitespace-pre-line [text-wrap:pretty]">
          {{ p }}
        </p>
      </div>
      <div
        class="flex flex-col gap-1 border-t border-line px-[18px] py-3 text-caption leading-[1.5] text-fg-muted"
        aria-label="Signature"
      >
        <p class="whitespace-pre-line">{{ signature }}</p>
        <Mono class="text-[11px]">Signature · added when the reply is sent</Mono>
      </div>
      <div v-if="reply.attachments.length" class="flex flex-wrap gap-2 px-[18px] pb-4">
        <SourceChip v-for="a in reply.attachments" :key="a.storagePath" class="px-2 py-1"
          >{{ a.name
          }}<template v-if="a.sizeBytes">
            · {{ Math.round(a.sizeBytes / 1024) }} KB</template
          ></SourceChip
        >
      </div>
    </div>
    <div
      v-if="check"
      class="flex items-center gap-2 text-caption"
      :class="
        check.tone === 'ember' ? 'text-ember' : check.tone === 'brick' ? 'text-brick' : 'text-sage'
      "
      role="status"
    >
      <span class="size-[6px] shrink-0 rounded-pill bg-current" aria-hidden="true" />{{
        check.text
      }}
    </div>
  </section>
</template>
