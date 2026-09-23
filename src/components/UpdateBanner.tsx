import { useSyncExternalStore } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isRecordingActive, useRecordingSession } from '../audio/recordingSession'

/**
 * Screens where it's safe to interrupt with an update prompt: nothing
 * mid-flow lives here. Deliberately excludes /lesson/*, /piano/record,
 * /piano/review and /help - a kid mid-mission or mid-take should never see
 * this, even if a take somehow isn't "recording" by isRecordingActive's
 * definition (e.g. reviewing a just-finished take).
 */
const IDLE_PATHS = new Set(['/home', '/cube', '/wall', '/piano', '/box', '/settings'])

// Module-level so the banner can be dismissed for the rest of this session
// without needing to be mounted anywhere that outlives a route change.
let dismissed = false
const dismissListeners = new Set<() => void>()

function setDismissed(next: boolean): void {
  if (dismissed === next) return
  dismissed = next
  for (const l of dismissListeners) l()
}

function subscribeDismissed(cb: () => void): () => void {
  dismissListeners.add(cb)
  return () => dismissListeners.delete(cb)
}

function getDismissedSnapshot(): boolean {
  return dismissed
}

/** Hides the "new version ready" banner for the rest of this session (e.g. after the kid taps to dismiss it). */
// oxlint-disable-next-line react/only-export-components -- dismiss() is the session-scoped control for this exact banner, not a generally reusable helper; splitting it into its own file would be pure indirection.
export function dismiss(): void {
  setDismissed(true)
}

/**
 * "A new build is ready" prompt (registerType: 'prompt' in vite.config.ts
 * means the new service worker never activates on its own - see the plan's
 * C2.1). Shown only when the app is genuinely idle: not recording, and on
 * one of a fixed set of "nothing to lose" screens. Never mounted by this
 * file - the integrator wires it in next to RecordingBanner (see App.tsx).
 */
export function UpdateBanner({ path }: { path: string }) {
  const session = useRecordingSession()
  const isDismissed = useSyncExternalStore(subscribeDismissed, getDismissedSnapshot, getDismissedSnapshot)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Vite-PWA only checks for an update once, at registration. Re-check
      // hourly so a long-lived open tab still notices a build that shipped
      // after it was opened, without ever reloading on its own.
      if (!registration) return
      setInterval(() => {
        void registration.update()
      }, 60 * 60 * 1000)
    },
  })

  const canShow = needRefresh && !isDismissed && !isRecordingActive(session) && IDLE_PATHS.has(path)
  if (!canShow) return null

  return (
    <div
      className="cc-safe-x"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.6rem',
        flexWrap: 'wrap',
        minHeight: 56,
        padding: '0.6rem 1rem',
        background: 'var(--cc-primary)',
        color: '#fff',
      }}
    >
      <strong style={{ fontSize: '0.95rem' }}>✨ New version ready</strong>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minHeight: 44, padding: '0.4rem 0.9rem' }}
          onClick={() => dismiss()}
        >
          Later
        </button>
        <button
          type="button"
          className="cc-btn"
          style={{ minHeight: 44, padding: '0.4rem 0.9rem', background: '#fff', color: 'var(--cc-primary)' }}
          onClick={() => void updateServiceWorker(true)}
        >
          ⬆ Update
        </button>
      </div>
    </div>
  )
}
