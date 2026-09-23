import { useState, type FormEvent, type ReactNode } from 'react'
import { checkSecret } from '../content/access'
import { requestPersistentStorage } from '../store/recordings'

const STORAGE_KEY = 'readaloud.unlocked'

function readUnlocked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeUnlocked() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // If storage is unavailable (private browsing, quota, etc.) we just fall
    // back to asking again next launch - not worth blocking on.
  }
}

export function Gate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(readUnlocked)
  const [word, setWord] = useState('')
  const [hidden, setHidden] = useState(false)
  const [shake, setShake] = useState(false)
  const [checking, setChecking] = useState(false)
  const [wrong, setWrong] = useState(false)

  if (unlocked) return <>{children}</>

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (checking) return
    setChecking(true)
    setWrong(false)
    const matched = await checkSecret(word)
    setChecking(false)
    if (matched) {
      writeUnlocked()
      setUnlocked(true)
      // Best-effort: some browsers only grant persistent storage inside a
      // user gesture, and this tap is the earliest one in the app's life.
      void requestPersistentStorage()
      return
    }
    setWrong(true)
    setShake(true)
    setWord('')
    setTimeout(() => setShake(false), 400)
  }

  return (
    <div
      className="cc-safe-top cc-safe-bottom cc-safe-x"
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
        padding: '2rem 1.25rem',
        background: 'var(--cc-bg, var(--cc-surface))',
        textAlign: 'center',
      }}
    >
      <div
        className="cc-card"
        style={{
          width: '100%',
          maxWidth: 380,
          padding: '2rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.1rem',
          animation: shake ? 'cc-shake 400ms' : undefined,
        }}
      >
        <span style={{ fontSize: '3.5rem', lineHeight: 1 }} aria-hidden="true">
          📖
        </span>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Read Aloud</h1>
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>What&apos;s the secret word?</p>

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              type={hidden ? 'password' : 'text'}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Secret word"
              aria-label="Secret word"
              style={{
                flex: 1,
                minHeight: 56,
                fontSize: '1.2rem',
                textAlign: 'center',
                borderRadius: 'var(--cc-radius)',
                border: '2px solid var(--cc-border)',
                padding: '0 1rem',
              }}
            />
            <button
              type="button"
              className="cc-btn cc-btn-surface"
              style={{ minHeight: 56, minWidth: 56, padding: '0.5rem' }}
              onClick={() => setHidden((h) => !h)}
              aria-label={hidden ? 'Show the secret word' : 'Hide the secret word'}
            >
              {hidden ? '👁️' : '🙈'}
            </button>
          </div>

          <button
            type="submit"
            className="cc-btn cc-btn-primary"
            style={{ minHeight: 56, fontSize: '1.15rem' }}
            disabled={checking || word.trim() === ''}
          >
            Let me in 📖
          </button>
        </form>

        {wrong && (
          <p role="alert" style={{ margin: 0, color: 'var(--cc-danger)', fontWeight: 700 }}>
            Hmm, not quite. Ask a grown-up!
          </p>
        )}
      </div>
    </div>
  )
}
