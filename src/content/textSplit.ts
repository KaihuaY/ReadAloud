// Pure text-splitting helpers for reading passages. No React, no side effects.

export interface WordToken {
  display: string
  norm: string
  start: number
  end: number
  sentenceIndex: number
}

/**
 * Lowercases, strips leading/trailing punctuation and quotes, but keeps
 * inner apostrophes and hyphens ("don't", "sun-hat"). Returns '' for a
 * token that is pure punctuation.
 */
export function normalizeWord(w: string): string {
  const lower = w.toLowerCase()
  const stripped = lower.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')
  return stripped
}

interface Segment {
  start: number
  end: number
  index: number
}

/** Scans the text once, returning raw (untrimmed) segment ranges plus the
 * sentence index each one would get once empty segments are dropped. */
function computeSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let segStart = 0
  let index = 0
  const flush = (rawEnd: number) => {
    const raw = text.slice(segStart, rawEnd)
    if (raw.trim().length > 0) {
      segments.push({ start: segStart, end: rawEnd, index })
      index++
    }
    segStart = rawEnd
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n' || ch === '\r') {
      flush(i)
      segStart = i + 1
    } else if (ch === '.' || ch === '!' || ch === '?') {
      flush(i + 1)
    }
  }
  flush(text.length)
  return segments
}

/**
 * Splits on . ! ? (keeping the mark) and treats newlines as sentence
 * breaks too. Trims each sentence and drops empty ones.
 */
export function splitSentences(text: string): string[] {
  if (!text) return []
  const segments = computeSegments(text)
  return segments.map((seg) => text.slice(seg.start, seg.end).trim())
}

/**
 * Whitespace-splits the text into word tokens with character offsets into
 * the ORIGINAL text. Tokens whose normalized form is '' (pure punctuation)
 * are skipped. sentenceIndex matches the boundaries splitSentences() would
 * produce (0-based).
 */
export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = []
  if (!text) return tokens

  const segments = computeSegments(text)
  const re = /\S+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const display = match[0]
    const start = match.index
    const end = start + display.length
    const norm = normalizeWord(display)
    if (norm === '') continue

    let sentenceIndex = 0
    for (const seg of segments) {
      if (start >= seg.start && start < seg.end) {
        sentenceIndex = seg.index
        break
      }
    }
    tokens.push({ display, norm, start, end, sentenceIndex })
  }
  return tokens
}

/** Counts real words (skips pure punctuation) in a passage's text. */
export function wordCount(text: string): number {
  return tokenizeWords(text).length
}
