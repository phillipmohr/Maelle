/**
 * Claude condenses a final reply into a Knowledge Base entry. Behind an interface: the Anthropic
 * adapter (ANTHROPIC_API_KEY, model MODELS.small from shared/config.ts) or a deterministic
 * fallback (first sentences of the reply) when there is no key or the call fails.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { MODELS } from '#shared/config'
import { EM_DASH_RE } from '#shared/proposal'

export const KB_CATEGORIES = [
  'Data & accuracy',
  'Tracking & scans',
  'Plans & pricing',
  'Billing & payments',
  'Account & access',
  'Privacy & safety',
  'Features',
] as const
export type KbCategory = (typeof KB_CATEGORIES)[number]

export const KB_TYPES = ['Explanation', 'Limitation', 'How-to', 'Known issue', 'Policy'] as const
export type KbType = (typeof KB_TYPES)[number]

export const DEFAULT_SMALL_MODEL: string = MODELS.small

export interface KbCondensationInput {
  subject: string | null
  caseLabel: string
  customerMessage: string
  reply: string
  suggestedCategory: KbCategory
  suggestedType: KbType
}

export const KbCondensationSchema = z.object({
  name: z.string().min(3).max(120),
  category: z.enum(KB_CATEGORIES),
  type: z.enum(KB_TYPES),
  customerPhrasing: z.string().min(3).max(600),
  shortAnswer: z.string().min(3).max(800),
})
export type KbCondensation = z.infer<typeof KbCondensationSchema>

export interface ModelClient {
  readonly kind: 'anthropic' | 'fallback'
  readonly model: string | null
  condenseKnowledge(input: KbCondensationInput): Promise<KbCondensation>
}

// ---------------------------------------------------------------- deterministic fallback

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(@])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function firstSentences(text: string, maxChars: number, max = 2): string {
  let out = ''
  for (const s of sentences(text).slice(0, max)) {
    if (out && out.length + s.length + 1 > maxChars) break
    out = out ? `${out} ${s}` : s
  }
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).trimEnd()}…`
  return out
}

/** Drops the greeting and the sign-off of a reply so the facts are left. */
export function stripReplyBoilerplate(reply: string): string {
  const paragraphs = reply
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const body: string[] = []
  for (const p of paragraphs) {
    if (/^(best|kind|warm) regards|^cheers|^thanks,|^thank you,|^sincerely/i.test(p)) break
    body.push(p)
  }
  if (body.length > 1 && /^(hi|hello|hey|dear)\b/i.test(body[0]!) && body[0]!.length < 140) {
    body.shift()
  }
  // Closing questions and offers add nothing to a knowledge entry.
  while (
    body.length > 1 &&
    /^(if you|let me know|if anything|just reply|feel free|should you|in case)/i.test(body.at(-1)!)
  ) {
    body.pop()
  }
  return body.join('\n\n')
}

export function cleanSubject(subject: string | null): string {
  if (!subject) return ''
  return subject
    .replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s
}

export function removeEmDashes(text: string): string {
  return text.replace(/\s*[—―]\s*/g, ', ')
}

export function condenseDeterministically(input: KbCondensationInput): KbCondensation {
  const subject = cleanSubject(input.subject)
  const nameSource = subject || firstSentences(input.customerMessage, 80, 1) || input.caseLabel
  const name = capitalize(nameSource.replace(/[.?!]+$/, '')).slice(0, 120)
  const customerPhrasing =
    firstSentences(input.customerMessage, 300, 2) || input.customerMessage.slice(0, 300)
  const body = stripReplyBoilerplate(input.reply)
  const shortAnswer = firstSentences(body, 400, 2) || firstSentences(input.reply, 400, 2)
  return {
    name: removeEmDashes(name),
    category: input.suggestedCategory,
    type: input.suggestedType,
    customerPhrasing: removeEmDashes(customerPhrasing),
    shortAnswer: removeEmDashes(shortAnswer),
  }
}

export function createFallbackModelClient(): ModelClient {
  return {
    kind: 'fallback',
    model: null,
    async condenseKnowledge(input) {
      return condenseDeterministically(input)
    },
  }
}

// ---------------------------------------------------------------- Anthropic adapter

const SYSTEM_PROMPT = [
  'You turn one resolved InstaRadar customer support ticket into one Knowledge Base entry.',
  'Use only facts that appear in the final reply. Do not invent policies, numbers or dates.',
  'Write in English. Never use an em dash.',
  'Fields:',
  '- name: a short, searchable title for the entry (not the email subject verbatim if it is vague).',
  '- category: one of the allowed categories.',
  '- type: one of the allowed types. Explanation = how something works, Limitation = what is not possible, How-to = steps, Known issue = an active bug, Policy = a business rule.',
  '- customerPhrasing: how customers ask about this, in their words, taken from the customer message.',
  '- shortAnswer: one or two customer-facing sentences with the answer.',
].join('\n')

const KB_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string', enum: [...KB_CATEGORIES] },
    type: { type: 'string', enum: [...KB_TYPES] },
    customerPhrasing: { type: 'string' },
    shortAnswer: { type: 'string' },
  },
  required: ['name', 'category', 'type', 'customerPhrasing', 'shortAnswer'],
  additionalProperties: false,
}

export function createAnthropicModelClient(opts: {
  apiKey: string
  model?: string
  logger?: (msg: string) => void
}): ModelClient {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 30_000, maxRetries: 1 })
  const model = opts.model || DEFAULT_SMALL_MODEL
  const logger = opts.logger ?? ((msg) => console.warn(msg))
  return {
    kind: 'anthropic',
    model,
    async condenseKnowledge(input) {
      const fallback = condenseDeterministically(input)
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                subject: input.subject,
                case: input.caseLabel,
                customerMessage: input.customerMessage,
                finalReply: input.reply,
                allowedCategories: KB_CATEGORIES,
                allowedTypes: KB_TYPES,
                suggestedCategory: input.suggestedCategory,
                suggestedType: input.suggestedType,
              }),
            },
          ],
          output_config: { format: { type: 'json_schema', schema: KB_JSON_SCHEMA } },
        })
        if (response.stop_reason === 'refusal') return fallback
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        const parsed = KbCondensationSchema.safeParse(JSON.parse(text))
        if (!parsed.success) {
          logger(`[learning] model output did not validate, using the fallback condensation`)
          return fallback
        }
        const d = parsed.data
        return {
          ...d,
          name: removeEmDashes(d.name),
          customerPhrasing: removeEmDashes(d.customerPhrasing),
          shortAnswer: removeEmDashes(d.shortAnswer),
        }
      } catch (e) {
        logger(
          `[learning] model call failed (${(e as Error).message}), using the fallback condensation`,
        )
        return fallback
      }
    },
  }
}

let fromEnv: ModelClient | null = null

export function modelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (fromEnv) return fromEnv
  fromEnv = env.ANTHROPIC_API_KEY
    ? createAnthropicModelClient({
        apiKey: env.ANTHROPIC_API_KEY,
        model: DEFAULT_SMALL_MODEL,
      })
    : createFallbackModelClient()
  return fromEnv
}

/** Tests only. */
export function resetModelClientForTests(): void {
  fromEnv = null
}

export { EM_DASH_RE }
