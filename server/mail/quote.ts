/**
 * Quote stripping for display (IRDR-455). `text_stripped` is the customer's own words: the quoted
 * history below "On ... wrote:" style headers, Outlook header blocks and `>` lines is removed.
 * Forwarded content is kept (the forwarded message often is the point). The full text is always
 * stored in text_body, so nothing is lost.
 */

const REPLY_HEADER_LINE: RegExp[] = [
  /^On .{4,300}wrote:\s*$/i, // English (Gmail, Apple Mail)
  /^Am .{4,300}schrieb .{0,300}:\s*$/i, // German
  /^Le .{4,300}a écrit\s?:\s*$/i, // French
  /^El .{4,300}escribió:\s*$/i, // Spanish
  /^Il .{4,300}ha scritto:\s*$/i, // Italian
  /^Op .{4,300}schreef .{0,300}:\s*$/i, // Dutch
  /^Em .{4,300}escreveu:\s*$/i, // Portuguese
  /^Den .{4,300}skrev .{0,300}:\s*$/i, // Swedish, Danish, Norwegian
  /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}.{0,200}<[^>]+@[^>]+>:?\s*$/, // Gmail in other locales
  /^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Message d'origine|Mensaje original)\s*-{2,}\s*$/i,
  /^_{8,}\s*$/, // Outlook separator line
]

const OUTLOOK_FROM = /^(From|Von|De|Da|Van)\s*:\s.+/i
const OUTLOOK_FOLLOW =
  /^(Sent|To|Subject|Cc|Date|Gesendet|An|Betreff|Envoyé|À|Objet|Enviado|Para|Asunto)\s*:\s/i
const FORWARD_MARKER =
  /^(-{3,}\s*(Forwarded message|Weitergeleitete Nachricht|Message transféré|Mensaje reenviado)\s*-{3,}|Begin forwarded message:|Anfang der weitergeleiteten (Nachricht|E-Mail):)/i

/** Two-line Gmail wrap: "On Mon, ... <a@b>" + "wrote:". */
function isWrappedReplyHeader(lines: string[], i: number): boolean {
  const first = lines[i] ?? ''
  if (!/^(On|Am|Le|El|Il|Op|Em|Den) .{4,}/.test(first)) return false
  for (const n of [2, 3]) {
    const joined = lines
      .slice(i, i + n)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (REPLY_HEADER_LINE.some((re) => re.test(joined))) return true
  }
  return false
}

export function stripQuotedText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let cut = lines.length
  let inForward = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd()
    if (FORWARD_MARKER.test(line.trim())) {
      inForward = true
      continue
    }
    if (line.startsWith('>')) {
      // A quoted block: cut here when everything after it is quoted or empty.
      const rest = lines.slice(i).filter((l) => l.trim() !== '')
      if (rest.every((l) => l.startsWith('>'))) {
        cut = i
        break
      }
      continue
    }
    if (inForward) continue
    if (REPLY_HEADER_LINE.some((re) => re.test(line)) || isWrappedReplyHeader(lines, i)) {
      cut = i
      break
    }
    if (OUTLOOK_FROM.test(line)) {
      const next = lines.slice(i + 1, i + 4).map((l) => l.trim())
      if (next.some((l) => OUTLOOK_FOLLOW.test(l))) {
        cut = i
        break
      }
    }
  }
  const kept = lines
    .slice(0, cut)
    .filter((l) => !l.startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Nothing but quotes: fall back to the whole text rather than showing an empty message.
  if (!kept) return text.replace(/\r\n?/g, '\n').trim()
  return kept
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  euro: '€',
  copy: '©',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/**
 * Minimal HTML to text: block elements become line breaks, list items get a dash, blockquotes are
 * prefixed with "> " so `stripQuotedText` treats them like plain-text quotes, everything else is
 * unwrapped and entity-decoded.
 */
export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, '\n')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  // Innermost blockquotes first, repeatedly, so nesting yields ">> ".
  const bq = /<blockquote\b[^>]*>((?:(?!<blockquote\b)[\s\S])*?)<\/blockquote>/gi
  for (let guard = 0; guard < 10 && bq.test(s); guard++) {
    s = s.replace(bq, (_m, inner: string) => {
      const innerText = htmlToText(inner)
      return (
        '\n' +
        innerText
          .split('\n')
          .map((l) => (l.startsWith('>') ? `>${l}` : `> ${l}`))
          .join('\n') +
        '\n'
      )
    })
  }
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li\b[^>]*>/gi, '\n- ')
  s = s.replace(/<\/li>/gi, '')
  s = s.replace(/<\/(p|div|tr|h[1-6]|pre|table|ul|ol|section|article|header|footer)>/gi, '\n')
  // Opening tags of paragraph-like blocks add a break too (so <p> paragraphs stay separated);
  // <div> does not, because Gmail wraps every single line in one.
  s = s.replace(/<(p|h[1-6]|pre|table|ul|ol)\b[^>]*>/gi, '\n')
  s = s.replace(/<td\b[^>]*>/gi, ' ')
  s = s.replace(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return text && text !== href ? `${text} (${href})` : href
    },
  )
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
