import { navigate } from '../router'
import { isRecordingActive, stopTake, useRecordingSession } from '../audio/recordingSession'

/**
 * Persistent reminder shown above the bottom nav whenever a reading take is
 * still recording but the kid has wandered off to another screen (the
 * bottom nav is always visible now - see App.tsx - so that's easy to do by
 * accident). The recording session itself is a module-level singleton (see
 * audio/recordingSession.ts) and keeps running regardless of what's
 * mounted, so nothing here is needed to protect the take - this is purely
 * so she doesn't forget it's still going.
 */
export function RecordingBanner({ path }: { path: string }) {
  const session = useRecordingSession()
  // The Read screen has its own Stop button, so the banner would just be a duplicate there.
  if (!isRecordingActive(session) || path.startsWith('/read/')) return null

  const passageId = session.status === 'recording' || session.status === 'starting' ? session.passageId : null
  const backPath = passageId ? `/read/${passageId}` : '/library'

  function handleStop() {
    void stopTake('user').then(() => navigate(backPath))
  }

  return (
    <div
      className="cc-safe-x"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.6rem',
        flexWrap: 'wrap',
        padding: '0.6rem 1rem',
        background: 'var(--cc-accent)',
        color: '#2b1900',
      }}
    >
      <strong style={{ fontSize: '0.95rem' }}>🎙️ Still recording… ⏹ Stop</strong>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minHeight: 44, padding: '0.4rem 0.9rem' }}
          onClick={() => navigate(backPath)}
        >
          Go back
        </button>
        <button
          type="button"
          className="cc-btn"
          style={{ minHeight: 44, padding: '0.4rem 0.9rem', background: '#2b1900', color: '#fff' }}
          onClick={handleStop}
        >
          ⏹ Stop
        </button>
      </div>
    </div>
  )
}
