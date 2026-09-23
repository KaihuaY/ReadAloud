import type { ReadingPassage } from '../content/passages'

export interface PassageCardProps {
  passage: ReadingPassage
  bestStars: 0 | 1 | 2 | 3
  readCount: number
  onOpen: () => void
}

/** A big tap card for one passage in the library: emoji, title, best stars, read count. */
export function PassageCard({ passage, bestStars, readCount, onOpen }: PassageCardProps) {
  return (
    <button
      type="button"
      className="cc-card"
      style={{
        minHeight: 96,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        padding: '0.9rem 1.1rem',
        textAlign: 'left',
        cursor: 'pointer',
        border: 'none',
      }}
      onClick={onOpen}
    >
      <span style={{ fontSize: '2rem', flexShrink: 0 }} aria-hidden="true">
        {passage.emoji}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '1.1rem' }}>{passage.title}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {bestStars > 0 && <span aria-hidden="true">{'⭐'.repeat(bestStars)}</span>}
          <span style={{ color: 'var(--cc-ink-soft)', fontWeight: 700, fontSize: '0.9rem' }}>
            {readCount > 0 ? `read ${readCount} ${readCount === 1 ? 'time' : 'times'}` : 'new!'}
          </span>
        </div>
      </div>
    </button>
  )
}
