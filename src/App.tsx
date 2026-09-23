import { useEffect, useRef, useState } from 'react'
import { Gate } from './components/Gate'
import { isInArea, useRoute } from './router'
import { useProgress } from './store/progress'
import { useSyncStatus, type SyncStatus } from './store/gistSync'
import { RecordingBanner } from './components/RecordingBanner'
import { UpdateBanner } from './components/UpdateBanner'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { Read } from './screens/Read'
import { BlindBox } from './screens/BlindBox'
import { ParentReview } from './screens/ParentReview'
import { Settings } from './screens/Settings'
import { Credits } from './screens/Credits'

interface NavItem {
  path: string
  label: string
  emoji: string
  /** For Books, the whole read area (not just the exact path) counts as active - see isInArea(). */
  area?: 'read'
}

const NAV_ITEMS: NavItem[] = [
  { path: '/home', label: 'Home', emoji: '🏠' },
  { path: '/library', label: 'Books', emoji: '📖', area: 'read' },
  { path: '/box', label: 'Box', emoji: '🎁' },
  { path: '/review', label: 'Grown-ups', emoji: '👀' },
]

const SYNC_DOT_COLOR: Record<SyncStatus, string> = {
  off: '#c7cad9',
  loading: '#ff8a00',
  saving: '#ff8a00',
  saved: '#1fa953',
  offline: '#c7cad9',
  expired: '#e62b2b',
  error: '#e62b2b',
}

// The Books tab goes back to wherever she was inside the read area (the
// library, mid-story, tricky words) instead of always the library home.
// Tapping the tab while already in the read area goes to the library home.
const LAST_PATH_PREFIX = 'readaloud.lastPath.'

function rememberAreaPath(path: string): void {
  if (!isInArea(path, 'read')) return
  try {
    sessionStorage.setItem(LAST_PATH_PREFIX + 'read', path)
  } catch {
    // ignore
  }
}

function lastAreaPath(area: 'read'): string | null {
  try {
    return sessionStorage.getItem(LAST_PATH_PREFIX + area)
  } catch {
    return null
  }
}

/** A simple placeholder for a screen this phase hasn't built yet, so the app still runs end to end. */
function ComingSoon({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 1rem 2rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{title}</h1>
      <div className="cc-card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--cc-ink-soft)', fontWeight: 700 }}>
        Coming soon
      </div>
    </div>
  )
}

function Screen({ path }: { path: string }) {
  if (path === '/home') return <Home />
  if (path === '/library') return <Library />
  if (path.startsWith('/read/')) return <Read />
  if (path === '/tricky') return <ComingSoon title="☀️ Tricky words" />
  if (path === '/box') return <BlindBox />
  if (path === '/review') return <ParentReview />
  if (path === '/settings') return <Settings />
  if (path === '/credits') return <Credits />
  return <Home />
}

function App() {
  const { path, navigate } = useRoute()
  const progress = useProgress()
  const syncStatus = useSyncStatus()
  const mainRef = useRef<HTMLElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  // The bottom stack (banners + menu) is position: fixed so it stays on
  // screen no matter which element ends up scrolling on a given browser;
  // <main> gets matching bottom padding so nothing hides behind it.
  const [bottomHeight, setBottomHeight] = useState(80)

  useEffect(() => {
    const el = bottomRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setBottomHeight(el.getBoundingClientRect().height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // <main> is the only scrolling region now - jump it back to the top on
  // every route change, same as a fresh page would.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    rememberAreaPath(path)
  }, [path])

  return (
    <Gate>
      <div className="cc-app-shell">
        <header
          className="cc-safe-top cc-safe-x"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'var(--cc-surface)',
            borderBottom: '1px solid var(--cc-border)',
            flexShrink: 0,
          }}
        >
          <strong style={{ fontSize: '1.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {progress.settings.kidName}&apos;s reading
          </strong>

          <span
            title={`Sync: ${syncStatus}`}
            aria-label={`Sync status: ${syncStatus}`}
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: SYNC_DOT_COLOR[syncStatus],
              flexShrink: 0,
            }}
          />
        </header>

        <main
          ref={mainRef}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: bottomHeight }}
        >
          <Screen path={path} />
        </main>

        <div ref={bottomRef} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40 }}>
          <RecordingBanner path={path} />
          <UpdateBanner path={path} />

          <nav
            className="cc-safe-bottom cc-safe-x"
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              gap: '0.25rem',
              padding: '0.5rem',
              background: 'var(--cc-surface)',
              borderTop: '1px solid var(--cc-border)',
              flexShrink: 0,
            }}
          >
            {NAV_ITEMS.map((item) => {
              const active = item.area ? isInArea(path, item.area) : path === item.path
              const target = item.area && !active ? (lastAreaPath(item.area) ?? item.path) : item.path
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(target)}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.15rem',
                    minHeight: 'var(--cc-touch)',
                    minWidth: 56,
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: active ? 'var(--cc-primary)' : 'var(--cc-ink-soft)',
                    fontWeight: active ? 800 : 600,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '1.3rem' }} aria-hidden="true">
                    {item.emoji}
                  </span>
                  <span style={{ fontSize: '0.7rem' }}>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>
    </Gate>
  )
}

export default App
