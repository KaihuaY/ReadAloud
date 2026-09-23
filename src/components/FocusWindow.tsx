import { splitSentences, tokenizeWords, type WordToken } from '../content/textSplit'

export interface FocusWindowProps {
  text: string
  sentenceIndex: number
  onSentenceChange?: (i: number) => void
  /** Char offset (relative to the current sentence) of the word being spoken during "Listen first"; -1 means "highlight the whole sentence" (no boundary event fired in time). */
  highlightCharIndex?: number | null
  /** Normalized (see textSplit's normalizeWord) tricky words - get the sun highlight + a small sun. */
  trickyWords?: Set<string>
  onWordTap?: (token: WordToken) => void
  fontSize?: string
}

function isWordLive(token: WordToken, highlightCharIndex?: number | null): boolean {
  if (highlightCharIndex === undefined || highlightCharIndex === null) return false
  if (highlightCharIndex === -1) return true
  return highlightCharIndex >= token.start && highlightCharIndex < token.end
}

function WordButton({
  token,
  isTricky,
  isLive,
  onTap,
}: {
  token: WordToken
  isTricky: boolean
  isLive: boolean
  onTap?: (token: WordToken) => void
}) {
  const classes = ['ra-word']
  if (isTricky) classes.push('ra-word-tricky')
  if (isLive) classes.push('ra-word-live')
  return (
    <button type="button" className={classes.join(' ')} onClick={() => onTap?.(token)}>
      {token.display}
      {isTricky && <span aria-hidden="true"> ☀️</span>}
    </button>
  )
}

/**
 * Renders ONLY the current sentence of `text` (picked by `sentenceIndex`)
 * huge, word by word, each word tappable. Below: sentence-nav arrows/dots,
 * shown only when the passage has more than one sentence. Used by the Read
 * screen's ready/recording states.
 */
export function FocusWindow({
  text,
  sentenceIndex,
  onSentenceChange,
  highlightCharIndex,
  trickyWords,
  onWordTap,
  fontSize = '2.2rem',
}: FocusWindowProps) {
  const sentences = splitSentences(text)
  const clampedIndex = Math.max(0, Math.min(sentenceIndex, Math.max(0, sentences.length - 1)))
  const sentence = sentences[clampedIndex] ?? ''
  const tokens = tokenizeWords(sentence)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', width: '100%' }}>
      <p
        style={{
          margin: 0,
          fontSize,
          lineHeight: 1.5,
          letterSpacing: '0.02em',
          wordSpacing: '0.15em',
          fontWeight: 800,
          textAlign: 'center',
        }}
      >
        {tokens.map((token, i) => (
          <WordButton
            key={`${clampedIndex}-${token.start}-${i}`}
            token={token}
            isTricky={trickyWords?.has(token.norm) ?? false}
            isLive={isWordLive(token, highlightCharIndex)}
            onTap={onWordTap}
          />
        ))}
      </p>
      {sentences.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ minHeight: 'var(--cc-touch)', minWidth: 'var(--cc-touch)' }}
            disabled={clampedIndex === 0}
            onClick={(e) => {
              // Stops here so a caller that wraps the whole window in its own
              // "tap anywhere advances" handler (the Read screen's recording
              // state) never also fires that handler for an explicit nav tap.
              e.stopPropagation()
              onSentenceChange?.(clampedIndex - 1)
            }}
            aria-label="Previous sentence"
          >
            ◀
          </button>
          <span style={{ color: 'var(--cc-ink-soft)', fontWeight: 700 }}>
            sentence {clampedIndex + 1} of {sentences.length}
          </span>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ minHeight: 'var(--cc-touch)', minWidth: 'var(--cc-touch)' }}
            disabled={clampedIndex === sentences.length - 1}
            onClick={(e) => {
              e.stopPropagation()
              onSentenceChange?.(clampedIndex + 1)
            }}
            aria-label="Next sentence"
          >
            ▶
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The whole passage, word by word, with the same tricky-word styling as
 * FocusWindow but at a smaller, non-huge font - used on the Read screen's
 * result state.
 */
export function PassageText({
  text,
  trickyWords,
  onWordTap,
  fontSize = '1.5rem',
}: {
  text: string
  trickyWords?: Set<string>
  onWordTap?: (token: WordToken) => void
  fontSize?: string
}) {
  const tokens = tokenizeWords(text)
  return (
    <p style={{ margin: 0, fontSize, lineHeight: 1.6, letterSpacing: '0.01em', wordSpacing: '0.1em', fontWeight: 700 }}>
      {tokens.map((token, i) => (
        <WordButton
          key={`${token.start}-${i}`}
          token={token}
          isTricky={trickyWords?.has(token.norm) ?? false}
          isLive={false}
          onTap={onWordTap}
        />
      ))}
    </p>
  )
}
