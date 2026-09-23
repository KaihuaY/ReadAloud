import { useState } from 'react'

/** A 4-digit PIN pad guarding parent-only screens (Settings, ticket redemption, parent review). */
export function PinGate({
  pin,
  onUnlock,
  title = 'Grown-up settings',
}: {
  pin: string
  onUnlock: () => void
  title?: string
}) {
  const [entry, setEntry] = useState('')
  const [shake, setShake] = useState(false)

  function press(digit: string) {
    const next = (entry + digit).slice(0, 4)
    setEntry(next)
    if (next.length === 4) {
      if (next === pin) {
        onUnlock()
      } else {
        setShake(true)
        setTimeout(() => {
          setShake(false)
          setEntry('')
        }, 400)
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', padding: '2rem 1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{title}</h1>
      <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>Enter the 4-digit PIN.</p>
      <div style={{ display: 'flex', gap: '0.6rem', animation: shake ? 'cc-shake 400ms' : undefined }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: i < entry.length ? 'var(--cc-primary)' : 'var(--cc-border)',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', width: 240 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) =>
          key === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className="cc-btn cc-btn-surface"
              style={{ fontSize: '1.2rem' }}
              onClick={() => (key === '⌫' ? setEntry((e) => e.slice(0, -1)) : press(key))}
            >
              {key}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
