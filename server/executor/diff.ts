/**
 * Reply diff for `decisions.reply_diff`: a simple line diff (LCS), plus the subject change. The UI
 * only needs to show what changed; nothing here has to be clever.
 */

export type DiffOp = 'keep' | 'add' | 'remove'

export interface DiffLine {
  op: DiffOp
  text: string
}

export interface ReplyDiff {
  subject: { from: string; to: string } | null
  lines: DiffLine[]
  added: number
  removed: number
}

export interface ActionChange {
  position: number
  field: string
  from: unknown
  to: unknown
}

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n')
  const y = b.split('\n')
  const n = x.length
  const m = y.length
  // LCS table; replies are short (< 200 lines), so n*m is fine.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: 'keep', text: x[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: 'remove', text: x[i]! })
      i++
    } else {
      out.push({ op: 'add', text: y[j]! })
      j++
    }
  }
  while (i < n) out.push({ op: 'remove', text: x[i++]! })
  while (j < m) out.push({ op: 'add', text: y[j++]! })
  return out
}

/** Null when nothing changed. */
export function replyDiff(
  from: { subject: string; body: string },
  to: { subject: string; body: string },
): ReplyDiff | null {
  const subjectChanged = from.subject !== to.subject
  const bodyChanged = from.body !== to.body
  if (!subjectChanged && !bodyChanged) return null
  const lines = bodyChanged ? lineDiff(from.body, to.body) : []
  return {
    subject: subjectChanged ? { from: from.subject, to: to.subject } : null,
    lines,
    added: lines.filter((l) => l.op === 'add').length,
    removed: lines.filter((l) => l.op === 'remove').length,
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Field-level changes of one action's params: `params.<key>` from → to. */
export function paramChanges(
  position: number,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): ActionChange[] {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)])
  const out: ActionChange[] = []
  for (const k of [...keys].sort()) {
    if (!same(from[k], to[k]))
      out.push({ position, field: `params.${k}`, from: from[k], to: to[k] })
  }
  return out
}
