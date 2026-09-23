import { BADGES } from '../content/badges'
import { useProgress } from '../store/progress'

/**
 * Every badge in the catalogue: earned ones in colour with the date earned,
 * unearned ones greyed out with a hint for how to get them. Mounted on the
 * Box screen's sticker tab.
 */
export function BadgeShelf() {
  const progress = useProgress()
  const earnedAt = new Map((progress.rewards.badges ?? []).map((b) => [b.id, b.earnedAt]))

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🏅 Badges</h2>
      <div
        className="cc-card"
        style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.75rem' }}
      >
        {BADGES.map((badge) => {
          const at = earnedAt.get(badge.id)
          const earned = at !== undefined
          return (
            <div
              key={badge.id}
              title={earned ? badge.title : badge.how}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.3rem',
                textAlign: 'center',
                padding: '0.5rem 0.25rem',
                borderRadius: '0.75rem',
                background: earned ? 'var(--cc-bg)' : 'transparent',
                opacity: earned ? 1 : 0.55,
              }}
            >
              <span style={{ fontSize: '2rem', filter: earned ? 'none' : 'grayscale(1)' }} aria-hidden="true">
                {badge.emoji}
              </span>
              <strong style={{ fontSize: '0.8rem' }}>{badge.title}</strong>
              <span style={{ fontSize: '0.7rem', color: 'var(--cc-ink-soft)' }}>
                {earned ? new Date(at).toLocaleDateString() : badge.how}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
