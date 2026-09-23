export interface WordChipProps {
  word: string
  onHear: () => void
}

/** One tricky word, shown huge on a sun-tinted card. Tapping it hears it too, same as any passage word. */
export function WordChip({ word, onHear }: WordChipProps) {
  return (
    <button
      type="button"
      onClick={onHear}
      aria-label={`Hear ${word}`}
      className="cc-card"
      style={{
        width: '100%',
        border: 'none',
        cursor: 'pointer',
        padding: '2.5rem 1rem',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--ra-sun)',
        color: 'var(--ra-sun-ink)',
        minHeight: 'var(--cc-touch)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '0.05em' }}>{word}</span>
    </button>
  )
}
