import { useEffect } from 'react'
import { BADGES } from '../content/badges'
import { dismissBadgeToast, useBadgeAwards, useBadgeToasts } from '../store/badges'
import { SayIt } from './SayIt'

const AUTO_HIDE_MS = 4000

function ToastCard({ id }: { id: string }) {
  const badge = BADGES.find((b) => b.id === id)

  useEffect(() => {
    const timer = setTimeout(() => dismissBadgeToast(id), AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [id])

  if (!badge) return null
  const spoken = `New badge: ${badge.title}!`

  return (
    <div className="cc-card" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <button
        type="button"
        onClick={() => dismissBadgeToast(id)}
        aria-label={`Dismiss: ${spoken}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          background: 'none',
          border: 'none',
          padding: 0,
          minHeight: 44,
          textAlign: 'left',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span style={{ fontSize: '1.6rem' }} aria-hidden="true">
          {badge.emoji}
        </span>
        <strong style={{ flex: 1 }}>🏅 {spoken}</strong>
      </button>
      <SayIt text={spoken} />
    </div>
  )
}

/**
 * Checks for newly-earned badges (via useBadgeAwards()) and renders the
 * resulting toast queue as fixed cards below the header, one per newly
 * earned badge. Each auto-hides after 4s or dismisses on tap. Renders
 * nothing when the queue is empty - safe to mount unconditionally on any
 * screen that should watch for badges (PianoHome, BlindBox, ParentReview;
 * Lesson/Wall mount it too, for cube-side badges).
 */
export function BadgeToast() {
  useBadgeAwards()
  const toasts = useBadgeToasts()

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: '1rem',
        right: '1rem',
        top: 'calc(var(--cc-safe-top) + 64px)',
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastCard id={t.id} />
        </div>
      ))}
    </div>
  )
}
