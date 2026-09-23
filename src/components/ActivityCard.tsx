import { RingTimer } from './RingTimer'

/** A tappable card for one activity on the Home screen: a small ring, streak, and status line. */
export function ActivityCard({
  emoji,
  title,
  ringProgress,
  streak,
  status,
  onClick,
}: {
  emoji: string
  title: string
  ringProgress: number
  streak: number
  status: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cc-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '1rem',
        minHeight: 56,
        width: '100%',
        textAlign: 'left',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        color: 'var(--cc-ink)',
      }}
    >
      <RingTimer progress={ringProgress} label={emoji} size={64} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '1.1rem' }}>{title}</strong>
        <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)', fontSize: '0.9rem' }}>{status}</span>
        <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>
          🔥 {streak}
        </span>
      </div>
    </button>
  )
}
