/**
 * Two-stage cases (refund, deletion): stage 1 asks the customer to confirm, stage 2 runs the
 * irreversible actions after an explicit "yes". This module detects the customer's answer in the
 * thread deterministically; the model sees the result as a hint and the finaliser enforces it.
 */
import type { MessageRow } from '#shared/api'
import type { ConfirmationSignal } from './types'

/** Drops quoted reply text ("> …", "On … wrote:") and signatures so only the new words count. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) break
    if (/^\s*On .{5,120} wrote:\s*$/i.test(line)) break
    if (/^\s*(Am|Le|El|Il) .{5,120}(schrieb|a écrit|escribió|ha scritto)\s*:?\s*$/i.test(line))
      break
    if (/^-{2,}\s*$/.test(line) || /^_{3,}\s*$/.test(line)) break
    if (/^\s*(From|Von|De|Da):\s.+/i.test(line) && out.length > 0) break
    out.push(line)
  }
  return out.join('\n').trim()
}

const DECLINE_RE =
  /\b(changed my mind|change my mind|don'?t (refund|cancel|delete|do it|proceed)|do not (refund|cancel|delete|proceed)|never ?mind|nevermind|keep (my|the) (subscription|account)|cancel that|forget it|not anymore|no longer want|please stop|hold off|on second thought|leave it|leave my account|no thanks|no thank you|no,? (please )?don'?t|nein|non merci|no gracias)\b/i

const CONFIRM_RE =
  /(^|\b)(yes|yep|yeah|yup|confirm|confirmed|i confirm|go ahead|proceed|please proceed|please do|do it|ok|okay|sure|fine|agreed|correct|that'?s (fine|right|correct)|refund (it|me|please)|please refund|delete (it|my account)|please delete|cancel (it|my subscription)|ja|oui|sí|si|sim|да|evet)\b/i

const NEGATION_NEAR_YES_RE = /\b(no|not|don'?t|do not|never)\b/i

/**
 * Reads the customer's latest inbound message that follows our latest outbound message.
 * Returns 'none' when there is no such exchange yet or the answer is ambiguous.
 */
export function detectConfirmation(messages: MessageRow[]): ConfirmationSignal {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const lastOutIdx = sorted.map((m) => m.direction).lastIndexOf('out')
  if (lastOutIdx < 0) return 'none'
  const replies = sorted.slice(lastOutIdx + 1).filter((m) => m.direction === 'in')
  const latest = replies[replies.length - 1]
  if (!latest) return 'none'
  const text = stripQuotedReply(latest.translation ?? latest.textBody ?? '')
  if (!text) return 'none'
  if (DECLINE_RE.test(text)) return 'declined'
  const firstSentence = text.split(/[.!?\n]/)[0] ?? text
  if (CONFIRM_RE.test(text)) {
    // "No, don't refund" contains no yes-word, but "not yes" style answers are ambiguous: be careful.
    if (
      NEGATION_NEAR_YES_RE.test(firstSentence) &&
      !/^\s*(yes|ja|oui|sí|si|ok|okay)\b/i.test(firstSentence)
    )
      return 'none'
    return 'confirmed'
  }
  return 'none'
}

/** True when the thread so far has only one inbound message and nothing from us. */
export function isNewConversation(messages: MessageRow[]): boolean {
  return messages.filter((m) => m.direction === 'out').length === 0
}
