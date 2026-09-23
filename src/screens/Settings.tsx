import { useRef, useState } from 'react'
import {
  useProgress,
  update,
  exportJson,
  importJson,
  listBackups,
  restoreBackup,
  resetAll,
} from '../store/progress'
import { adjustTokens } from '../store/reading'
import { clearToken, getToken, setToken, start as startSync, stop as stopSync, useSyncStatus } from '../store/gistSync'
import { PinGate } from '../components/PinGate'
import { navigate } from '../router'
import { formatBytes } from '../store/recordings'
import { APP_BUILD } from '../buildInfo'
import type { Tier } from '../store/rewards'

// Re-exported so BlindBox.tsx's `import { PinGate } from './Settings'` keeps working.
export { PinGate } from '../components/PinGate'

const READING_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const READS_PER_DAY_OPTIONS = [1, 2, 3, 4, 5]
const MAX_SECONDS_OPTIONS = [30, 45, 60, 90]
const TIERS: Tier[] = ['gold', 'silver', 'bronze']
const BOX_TIER_EMOJI: Record<Tier, string> = { gold: '🟡', silver: '⚪', bronze: '🟤' }
const BOX_TIER_LABEL: Record<Tier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' }

/** Downscales an uploaded image to a small square PNG data URL. Kept for Phase 2's "photo of a book page" flow. */
export function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not read that image'))
      img.onload = () => {
        const maxSize = 256
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas not supported'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

const BOX_MINUS_CONFIRM_MS = 4000

function BoxTokensSection() {
  const progress = useProgress()
  const tokens = progress.profile.tokens
  const [confirming, setConfirming] = useState<Tier | null>(null)
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleMinusClick(tier: Tier) {
    if (confirmTimeout.current) {
      clearTimeout(confirmTimeout.current)
      confirmTimeout.current = null
    }
    if (confirming === tier) {
      setConfirming(null)
      adjustTokens(tier, -1)
      return
    }
    setConfirming(tier)
    confirmTimeout.current = setTimeout(() => {
      setConfirming(null)
      confirmTimeout.current = null
    }, BOX_MINUS_CONFIRM_MS)
  }

  return (
    <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>🎁 Boxes</h2>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
        Give or take away box tokens - for chores, kindness, or a correction.
      </p>
      {TIERS.map((tier) => {
        const count = tokens[tier]
        const isConfirming = confirming === tier
        return (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ flex: 1, fontWeight: 700 }}>
              {BOX_TIER_EMOJI[tier]} {BOX_TIER_LABEL[tier]}
            </span>
            <span
              data-testid={`box-count-${tier}`}
              style={{ minWidth: '2.5ch', textAlign: 'center', fontWeight: 700, fontSize: '1.1rem' }}
            >
              {count}
            </span>
            <button
              type="button"
              className="cc-btn cc-btn-surface"
              data-testid={isConfirming ? `box-minus-confirm-${tier}` : `box-minus-${tier}`}
              style={{
                minHeight: 56,
                minWidth: 56,
                padding: '0 0.5rem',
                background: isConfirming ? 'var(--cc-danger)' : undefined,
                color: isConfirming ? '#fff' : undefined,
              }}
              disabled={count <= 0}
              onClick={() => handleMinusClick(tier)}
              aria-label={isConfirming ? `Confirm remove one ${BOX_TIER_LABEL[tier]} token` : `Remove one ${BOX_TIER_LABEL[tier]} token`}
            >
              {isConfirming ? 'Remove? ✓' : '−'}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-surface"
              data-testid={`box-plus-${tier}`}
              style={{ minHeight: 56, minWidth: 56, padding: 0 }}
              onClick={() => adjustTokens(tier, 1)}
              aria-label={`Add one ${BOX_TIER_LABEL[tier]} token`}
            >
              ＋
            </button>
          </div>
        )
      })}
    </section>
  )
}

export function Settings() {
  const progress = useProgress()
  const syncStatus = useSyncStatus()
  const [unlocked, setUnlocked] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [newPin, setNewPin] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [backups, setBackups] = useState(() => listBackups())
  const [confirmingRestoreIndex, setConfirmingRestoreIndex] = useState<number | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  function refreshBackups() {
    setBackups(listBackups())
  }

  if (!unlocked) {
    return <PinGate pin={progress.settings.pin} onUnlock={() => setUnlocked(true)} />
  }

  const settings = progress.settings

  function handleExport() {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'read-aloud-backup.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(file: File) {
    setImportError(null)
    try {
      const text = await file.text()
      importJson(text)
      refreshBackups() // importJson doesn't itself take an automatic backup, but restoreBackup below does - keep the list fresh either way
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'That file did not look like a Read Aloud backup.')
    }
  }

  function handleRestoreBackup(index: number) {
    restoreBackup(index)
    setConfirmingRestoreIndex(null)
    refreshBackups()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem 1rem 3rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Grown-up settings</h1>

      <button type="button" className="cc-btn cc-btn-surface" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/review')}>
        👀 Grown-up review
      </button>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Names</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
          Kid&apos;s name
          <input
            value={settings.kidName}
            onChange={(e) => update('settings', (s) => ({ ...s, kidName: e.target.value }))}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
          Parent&apos;s name
          <input
            value={settings.parentName}
            onChange={(e) => update('settings', (s) => ({ ...s, parentName: e.target.value }))}
          />
        </label>
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Reading</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Level</span>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {READING_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className="cc-btn"
                data-testid={`reading-level-${level}`}
                onClick={() => update('settings', (s) => ({ ...s, readingLevel: level }))}
                style={{
                  flex: '1 1 40px',
                  minWidth: 40,
                  background: settings.readingLevel === level ? 'var(--cc-primary)' : 'var(--cc-surface)',
                  color: settings.readingLevel === level ? '#fff' : 'var(--cc-ink)',
                  border: settings.readingLevel === level ? 'none' : '2px solid var(--cc-border)',
                  boxShadow: 'none',
                }}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Reads per day</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {READS_PER_DAY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className="cc-btn"
                onClick={() => update('settings', (s) => ({ ...s, readsPerDay: n }))}
                style={{
                  flex: 1,
                  background: settings.readsPerDay === n ? 'var(--cc-primary)' : 'var(--cc-surface)',
                  color: settings.readsPerDay === n ? '#fff' : 'var(--cc-ink)',
                  border: settings.readsPerDay === n ? 'none' : '2px solid var(--cc-border)',
                  boxShadow: 'none',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Max recording length</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {MAX_SECONDS_OPTIONS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className="cc-btn"
                onClick={() => update('settings', (s) => ({ ...s, maxRecordSeconds: seconds }))}
                style={{
                  flex: 1,
                  background: settings.maxRecordSeconds === seconds ? 'var(--cc-primary)' : 'var(--cc-surface)',
                  color: settings.maxRecordSeconds === seconds ? '#fff' : 'var(--cc-ink)',
                  border: settings.maxRecordSeconds === seconds ? 'none' : '2px solid var(--cc-border)',
                  boxShadow: 'none',
                }}
              >
                {seconds}s
              </button>
            ))}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 700, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={settings.listenFirst}
            onChange={(e) => update('settings', (s) => ({ ...s, listenFirst: e.target.checked }))}
            style={{ width: 24, height: 24 }}
          />
          Offer "Listen first" before recording
        </label>
      </section>

      <BoxTokensSection />

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>PIN</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="New 4-digit PIN"
            inputMode="numeric"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="cc-btn cc-btn-primary"
            disabled={newPin.length !== 4}
            onClick={() => {
              update('settings', (s) => ({ ...s, pin: newPin }))
              setNewPin('')
            }}
          >
            Save PIN
          </button>
        </div>
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>GitHub sync</h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>Status: {syncStatus}</p>
        {getToken() ? (
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            onClick={() => {
              clearToken()
              stopSync()
            }}
          >
            Disconnect
          </button>
        ) : (
          <>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How do I get a token?</summary>
              <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.9rem' }}>
                <li>Go to github.com and sign in</li>
                <li>Settings → Developer settings → Fine-grained tokens</li>
                <li>Generate new token, expiry 1 year</li>
                <li>Under Account permissions, set Gists to "Read and write"</li>
                <li>Generate, copy the token, and paste it below</li>
              </ol>
            </details>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste GitHub token"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="cc-btn cc-btn-primary"
                disabled={tokenInput.trim() === ''}
                onClick={() => {
                  setToken(tokenInput.trim())
                  setTokenInput('')
                  startSync()
                }}
              >
                Connect
              </button>
            </div>
          </>
        )}
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Backup</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="cc-btn cc-btn-surface" onClick={handleExport}>
            Export backup
          </button>
          <button type="button" className="cc-btn cc-btn-surface" onClick={() => importInputRef.current?.click()}>
            Import backup
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportFile(file)
              if (importInputRef.current) importInputRef.current.value = ''
            }}
          />
        </div>
        {importError && <p style={{ margin: 0, color: 'var(--cc-danger)' }}>{importError}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong>Automatic backups</strong>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
            The app quietly saves a copy here whenever it notices something changed under the hood - a safety net,
            not something you need to manage day to day.
          </p>
          {backups.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>No automatic backups yet.</p>
          ) : (
            backups.map((b, index) => (
              <div
                key={`${b.savedAt}-${index}`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                <span style={{ flex: 1, fontSize: '0.85rem' }}>
                  {new Date(b.savedAt).toLocaleString()} · build {b.buildId} · {formatBytes(b.bytes)}
                </span>
                {confirmingRestoreIndex === index ? (
                  <>
                    <button
                      type="button"
                      className="cc-btn"
                      style={{ minHeight: 36, padding: '0.3rem 0.75rem', background: 'var(--cc-danger)', color: '#fff' }}
                      onClick={() => handleRestoreBackup(index)}
                    >
                      Really restore?
                    </button>
                    <button
                      type="button"
                      className="cc-btn cc-btn-surface"
                      style={{ minHeight: 36, padding: '0.3rem 0.75rem' }}
                      onClick={() => setConfirmingRestoreIndex(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="cc-btn cc-btn-surface"
                    style={{ minHeight: 36, padding: '0.3rem 0.75rem' }}
                    onClick={() => setConfirmingRestoreIndex(index)}
                  >
                    Restore
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--cc-ink-soft)' }}>Version: {APP_BUILD}</p>
        <a href="#/credits" style={{ fontSize: '0.8rem', color: 'var(--cc-ink-soft)', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
          📷 Photo credits for the collection
        </a>
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '2px solid var(--cc-danger)' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--cc-danger)' }}>Danger zone</h2>
        {!confirmingReset ? (
          <button
            type="button"
            className="cc-btn"
            style={{ background: 'var(--cc-danger)', color: '#fff' }}
            onClick={() => setConfirmingReset(true)}
          >
            Reset all progress
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontWeight: 700 }}>This erases all progress, tokens, and stories read. Are you sure?</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="cc-btn"
                style={{ background: 'var(--cc-danger)', color: '#fff' }}
                onClick={() => {
                  resetAll()
                  setConfirmingReset(false)
                }}
              >
                Yes, reset everything
              </button>
              <button type="button" className="cc-btn cc-btn-surface" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
