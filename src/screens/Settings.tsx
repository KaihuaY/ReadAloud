import { useEffect, useRef, useState } from 'react'
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
import {
  isDriveConfigured,
  retryFailedUploads,
  testDriveConnection,
  useUploadSummary,
  type DriveConfig,
} from '../store/driveUpload'
import { coachStatus, type CoachStatusResult } from '../store/readingCoach'
import { clearToken, getToken, setToken, start as startSync, stop as stopSync, useSyncStatus } from '../store/gistSync'
import { PinGate } from '../components/PinGate'
import { navigate } from '../router'
import { formatBytes, getRecordingStore } from '../store/recordings'
import { APP_BUILD } from '../buildInfo'
import type { Tier } from '../store/rewards'
import { LEVELS, type PassageLevel, type ReadingPassage } from '../content/passages'
import { myBooks, removeCustomPassage } from '../store/customPassages'
import { DEFAULT_FIND_TITLE, findBook, ocrPage } from '../store/passageLookup'
import { PassageForm, type PassageFormInitial, type PassageFormSource } from '../components/PassageForm'

// Re-exported so BlindBox.tsx's `import { PinGate } from './Settings'` keeps working.
export { PinGate } from '../components/PinGate'

const READING_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const READS_PER_DAY_OPTIONS = [1, 2, 3, 4, 5]
const MAX_SECONDS_OPTIONS = [30, 45, 60, 90]
const RECORDING_KEEP_OPTIONS = [7, 14, 30, 90]
const TIERS: Tier[] = ['gold', 'silver', 'bronze']
const BOX_TIER_EMOJI: Record<Tier, string> = { gold: '🟡', silver: '⚪', bronze: '🟤' }
const BOX_TIER_LABEL: Record<Tier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' }
const DEFAULT_FOLDER_NAME = 'Read Aloud takes'
const EMPTY_DRIVE_CFG: DriveConfig = { scriptUrl: '', secret: '', folderName: DEFAULT_FOLDER_NAME }

/**
 * Downscales an uploaded image so its longest side is at most `maxPx`,
 * returned as a data URL. Used for the "My passages" photo-of-a-page flow
 * (1600px JPEG, for the OCR script) with defaults that match the original
 * 256px PNG use.
 */
export function downscaleImage(
  file: File,
  maxPx = 256,
  mimeType: 'image/jpeg' | 'image/png' = 'image/png',
  quality = 0.9,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not read that image'))
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas not supported'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL(mimeType, quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/** Plain-words message for a passageLookup failure reason - shown next to the photo/find buttons. */
function lookupErrorMessage(reason: string): string {
  if (reason === 'not-configured') return "The page reader isn't set up yet - add the script URL and secret above"
  if (reason === 'cap') return 'Daily limit reached'
  return `Couldn't read the page: ${reason}`
}

/** The visible source label for a saved "My books" passage (the seed book gets its own label at the call site). */
function passageSourceLabel(passage: ReadingPassage): string {
  switch (passage.source) {
    case 'typed':
      return 'Typed by a grown-up'
    case 'photo':
      return 'From a photo of a page'
    case 'book-excerpt':
      return 'Excerpt found online'
    case 'book-original':
      return passage.sourceNote ?? "Made up from the story - not the book's words"
    default:
      return ''
  }
}

/** Which inline "My passages" flow (if any) is open - only one at a time. */
type MyPassagesForm =
  | { kind: 'typed' }
  | { kind: 'photo'; prefill: { title: string; text: string }; warnings: string[] }
  | { kind: 'find' }
  | { kind: 'find-excerpt'; prefill: { title: string; text: string } }
  | { kind: 'find-original'; prefill: { title: string; text: string; sourceNote: string } }
  | { kind: 'edit'; id: string; source: PassageFormSource; prefill: PassageFormInitial }

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
  const uploadSummary = useUploadSummary()
  const [recordingStats, setRecordingStats] = useState<{ count: number; bytes: number } | null>(null)
  // The Drive secret is masked by default; the grown-up (already past the PIN) can reveal it to
  // copy it into the Apps Script's UPLOAD_SECRET property.
  const [secretHidden, setSecretHidden] = useState(true)
  const [testingDrive, setTestingDrive] = useState(false)
  const [driveTestMessage, setDriveTestMessage] = useState<string | null>(null)
  const [testingCoach, setTestingCoach] = useState(false)
  const [coachStatusResult, setCoachStatusResult] = useState<CoachStatusResult | null>(null)
  const [passagesForm, setPassagesForm] = useState<MyPassagesForm | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoMessage, setPhotoMessage] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [findTitle, setFindTitle] = useState<string | null>(null)
  const [findLevel, setFindLevel] = useState<PassageLevel>(progress.settings.readingLevel)
  const [findBusy, setFindBusy] = useState(false)
  const [findMessage, setFindMessage] = useState<string | null>(null)

  function refreshBackups() {
    setBackups(listBackups())
  }

  function refreshRecordingStats() {
    const store = getRecordingStore()
    Promise.all([store.list(), store.usageBytes()]).then(([items, bytes]) => {
      setRecordingStats({ count: items.length, bytes })
    })
  }

  useEffect(() => {
    refreshRecordingStats()
    // Runs once on mount - the recordings store lives outside React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!unlocked) {
    return <PinGate pin={progress.settings.pin} onUnlock={() => setUnlocked(true)} />
  }

  const settings = progress.settings
  const driveCfg = settings.driveUpload ?? EMPTY_DRIVE_CFG

  function setDriveField(patch: Partial<DriveConfig>) {
    const next = { ...driveCfg, ...patch }
    update('settings', (s) => ({
      ...s,
      driveUpload: next.scriptUrl.trim() === '' && next.secret.trim() === '' ? undefined : next,
    }))
  }

  async function handleTestDrive() {
    setTestingDrive(true)
    setDriveTestMessage(null)
    const result = await testDriveConnection({
      scriptUrl: driveCfg.scriptUrl,
      secret: driveCfg.secret,
      folderName: driveCfg.folderName || DEFAULT_FOLDER_NAME,
    })
    setDriveTestMessage(result.message)
    setTestingDrive(false)
  }

  async function handleTestCoach() {
    setTestingCoach(true)
    setCoachStatusResult(null)
    const result = await coachStatus()
    setCoachStatusResult(result)
    setTestingCoach(false)
  }

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

  async function handlePhotoFile(file: File) {
    setPhotoMessage(null)
    setPhotoBusy(true)
    try {
      const dataUrl = await downscaleImage(file, 1600, 'image/jpeg', 0.85)
      const commaIndex = dataUrl.indexOf(',')
      const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
      const result = await ocrPage(base64, 'image/jpeg')
      if (result.ok) {
        setPassagesForm({
          kind: 'photo',
          prefill: { title: result.result.title, text: result.result.text },
          warnings: result.result.warnings,
        })
      } else {
        setPhotoMessage(lookupErrorMessage(result.reason))
      }
    } catch (err) {
      setPhotoMessage(err instanceof Error ? err.message : "Couldn't read that photo.")
    } finally {
      setPhotoBusy(false)
    }
  }

  async function handleFindBook() {
    const title = (findTitle ?? DEFAULT_FIND_TITLE).trim()
    if (title === '') return
    setFindMessage(null)
    setFindBusy(true)
    try {
      const result = await findBook(title, findLevel)
      if (!result.ok) {
        setFindMessage(lookupErrorMessage(result.reason))
        return
      }
      if (result.result.kind === 'none') {
        setFindMessage("I couldn't find that book. You can type a passage or take a photo of a page instead.")
        return
      }
      if (result.result.kind === 'excerpt') {
        setPassagesForm({ kind: 'find-excerpt', prefill: { title: result.result.title, text: result.result.text } })
      } else {
        setPassagesForm({
          kind: 'find-original',
          prefill: { title: result.result.title, text: result.result.text, sourceNote: result.result.note },
        })
      }
    } finally {
      setFindBusy(false)
    }
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

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>📚 My passages</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {myBooks(settings).map((passage) => {
            const isSeed = passage.id.startsWith('book-princess')
            const editing = passagesForm?.kind === 'edit' && passagesForm.id === passage.id
            return (
              <div key={passage.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.6rem', flexShrink: 0 }} aria-hidden="true">
                    {passage.emoji}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{passage.title}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>
                      Level {passage.level} · {passage.wordCount} words ·{' '}
                      {isSeed ? 'built-in example' : passageSourceLabel(passage)}
                    </span>
                  </div>
                  {!isSeed && (
                    <>
                      <button
                        type="button"
                        className="cc-btn cc-btn-surface"
                        style={{ minHeight: 44, minWidth: 44, padding: '0.4rem' }}
                        aria-label={`Edit ${passage.title}`}
                        onClick={() => {
                          setPhotoMessage(null)
                          setFindMessage(null)
                          setPassagesForm({
                            kind: 'edit',
                            id: passage.id,
                            source: (passage.source as PassageFormSource | undefined) ?? 'typed',
                            prefill: {
                              id: passage.id,
                              title: passage.title,
                              text: passage.text,
                              level: passage.level,
                              emoji: passage.emoji,
                              sourceNote: passage.sourceNote,
                            },
                          })
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="cc-btn cc-btn-surface"
                        style={{ minHeight: 44, minWidth: 44, padding: '0.4rem', color: 'var(--cc-danger)' }}
                        aria-label={`Delete ${passage.title}`}
                        onClick={() => {
                          if (window.confirm(`Delete "${passage.title}"?`)) removeCustomPassage(passage.id)
                        }}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
                {editing && passagesForm && passagesForm.kind === 'edit' && (
                  <PassageForm
                    initial={passagesForm.prefill}
                    source={passagesForm.source}
                    onSave={() => setPassagesForm(null)}
                    onCancel={() => setPassagesForm(null)}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ minHeight: 56 }}
            onClick={() => {
              setPhotoMessage(null)
              setFindMessage(null)
              setPassagesForm(passagesForm?.kind === 'typed' ? null : { kind: 'typed' })
            }}
          >
            ✍️ Type a passage
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ minHeight: 56 }}
            disabled={!isDriveConfigured(settings)}
            onClick={() => {
              setPassagesForm(null)
              setFindMessage(null)
              photoInputRef.current?.click()
            }}
          >
            📷 Photo of a page
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ minHeight: 56 }}
            onClick={() => {
              setPhotoMessage(null)
              const isFindFlow =
                passagesForm?.kind === 'find' || passagesForm?.kind === 'find-excerpt' || passagesForm?.kind === 'find-original'
              setPassagesForm(isFindFlow ? null : { kind: 'find' })
            }}
          >
            🔎 Find a book by title
          </button>
        </div>
        {!isDriveConfigured(settings) && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>
            Set up Google Drive + AI below to use the photo reader.
          </p>
        )}

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handlePhotoFile(file)
            if (photoInputRef.current) photoInputRef.current.value = ''
          }}
        />

        {photoBusy && <p style={{ margin: 0 }}>Reading the page...</p>}
        {photoMessage && <p style={{ margin: 0, color: 'var(--cc-danger)' }}>{photoMessage}</p>}

        {passagesForm?.kind === 'typed' && (
          <PassageForm source="typed" onSave={() => setPassagesForm(null)} onCancel={() => setPassagesForm(null)} />
        )}

        {passagesForm?.kind === 'photo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {passagesForm.warnings.length > 0 && (
              <div
                style={{
                  background: '#fff3d6',
                  border: '1px solid #f0c36d',
                  borderRadius: '0.75rem',
                  padding: '0.6rem',
                  fontSize: '0.85rem',
                }}
              >
                {passagesForm.warnings.join(' ')}
              </div>
            )}
            <PassageForm
              initial={{ title: passagesForm.prefill.title, text: passagesForm.prefill.text, level: settings.readingLevel }}
              source="photo"
              onSave={() => setPassagesForm(null)}
              onCancel={() => setPassagesForm(null)}
            />
          </div>
        )}

        {passagesForm?.kind === 'find' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
              Book title
              <input value={findTitle ?? DEFAULT_FIND_TITLE} onChange={(e) => setFindTitle(e.target.value)} />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Level</span>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {LEVELS.map((l) => (
                  <button
                    key={l.level}
                    type="button"
                    className="cc-btn"
                    onClick={() => setFindLevel(l.level)}
                    style={{
                      flex: '1 1 40px',
                      minWidth: 40,
                      background: findLevel === l.level ? 'var(--cc-primary)' : 'var(--cc-surface)',
                      color: findLevel === l.level ? '#fff' : 'var(--cc-ink)',
                      border: findLevel === l.level ? 'none' : '2px solid var(--cc-border)',
                      boxShadow: 'none',
                    }}
                  >
                    {l.level}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="cc-btn cc-btn-primary" disabled={findBusy} onClick={() => void handleFindBook()}>
              {findBusy ? 'Looking it up...' : 'Find'}
            </button>
            {findBusy && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>This can take up to a minute.</p>
            )}
            {findMessage && <p style={{ margin: 0 }}>{findMessage}</p>}
          </div>
        )}

        {passagesForm?.kind === 'find-excerpt' && (
          <PassageForm
            initial={{ title: passagesForm.prefill.title, text: passagesForm.prefill.text, level: findLevel }}
            source="book-excerpt"
            onSave={() => setPassagesForm(null)}
            onCancel={() => setPassagesForm(null)}
          />
        )}

        {passagesForm?.kind === 'find-original' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
              This is a short made-up passage about the story, not the book&apos;s own words. Edit it as you like.
            </p>
            <PassageForm
              initial={{
                title: passagesForm.prefill.title,
                text: passagesForm.prefill.text,
                level: findLevel,
                sourceNote: passagesForm.prefill.sourceNote,
              }}
              source="book-original"
              onSave={() => setPassagesForm(null)}
              onCancel={() => setPassagesForm(null)}
            />
          </div>
        )}

        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>
          Passages you add here show up under My books and sync to your other devices.
        </p>
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Recordings</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Keep local audio for</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {RECORDING_KEEP_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className="cc-btn"
                onClick={() => update('settings', (s) => ({ ...s, recordingKeepDays: days }))}
                style={{
                  flex: 1,
                  background: settings.recordingKeepDays === days ? 'var(--cc-primary)' : 'var(--cc-surface)',
                  color: settings.recordingKeepDays === days ? '#fff' : 'var(--cc-ink)',
                  border: settings.recordingKeepDays === days ? 'none' : '2px solid var(--cc-border)',
                  boxShadow: 'none',
                }}
              >
                {days} days
              </button>
            ))}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
          Recordings on this device: {recordingStats?.count ?? '…'} · {recordingStats ? formatBytes(recordingStats.bytes) : '…'}
        </p>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
          ☁️ {uploadSummary.done} saved · {uploadSummary.pending} waiting · {uploadSummary.failed} failed
        </p>
        {uploadSummary.failed > 0 && (
          <button type="button" className="cc-btn cc-btn-surface" style={{ alignSelf: 'flex-start' }} onClick={() => retryFailedUploads()}>
            Retry failed uploads
          </button>
        )}
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Google Drive + AI</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
          Script URL
          <input
            value={driveCfg.scriptUrl}
            onChange={(e) => setDriveField({ scriptUrl: e.target.value })}
            placeholder="https://script.google.com/macros/s/.../exec"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
          Secret
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type={secretHidden ? 'password' : 'text'}
              data-testid="drive-secret"
              value={driveCfg.secret}
              onChange={(e) => setDriveField({ secret: e.target.value })}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              data-testid="drive-secret-toggle"
              className="cc-btn cc-btn-surface"
              style={{ minHeight: 56, minWidth: 56, padding: '0.5rem' }}
              onClick={() => setSecretHidden((h) => !h)}
              aria-label={secretHidden ? 'Show the secret' : 'Hide the secret'}
            >
              {secretHidden ? '👁️' : '🙈'}
            </button>
          </div>
          <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>
            This must be the same word as the <code>UPLOAD_SECRET</code> property in your Apps Script.
          </span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
          Folder name
          <input
            value={driveCfg.folderName}
            onChange={(e) => setDriveField({ folderName: e.target.value })}
            placeholder={DEFAULT_FOLDER_NAME}
          />
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="cc-btn cc-btn-surface" disabled={testingDrive} onClick={() => void handleTestDrive()}>
            {testingDrive ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            disabled={testingCoach || !isDriveConfigured(settings)}
            onClick={() => void handleTestCoach()}
          >
            {testingCoach ? 'Testing…' : 'Test ear + coach'}
          </button>
        </div>
        {driveTestMessage && <p style={{ margin: 0, fontSize: '0.85rem' }}>{driveTestMessage}</p>}
        {coachStatusResult &&
          (coachStatusResult.ok ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem' }}>
              <span>
                👂 Gemini ({coachStatusResult.geminiModel ?? 'model unknown'}):{' '}
                {coachStatusResult.hasGeminiKey
                  ? coachStatusResult.geminiOk
                    ? 'ready ✅'
                    : `key found, but ${coachStatusResult.geminiError ?? 'it did not answer'}`
                  : 'no key yet'}
              </span>
              <span>
                ✍️ Claude:{' '}
                {coachStatusResult.hasClaudeKey
                  ? coachStatusResult.claudeOk
                    ? 'ready ✅'
                    : `key found, but ${coachStatusResult.claudeError ?? 'it did not answer'}`
                  : 'no key yet'}
              </span>
              <span>
                Ear used today: {coachStatusResult.readUsedToday ?? 0} / {coachStatusResult.readCap ?? 0}
              </span>
              <span>
                Coach notes used today: {coachStatusResult.coachUsedToday ?? 0} / {coachStatusResult.coachCap ?? 0}
              </span>
              <span>
                Book lookups used today: {coachStatusResult.lookupUsedToday ?? 0} / {coachStatusResult.lookupCap ?? 0}
              </span>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '0.85rem' }}>{coachStatusResult.reason ?? 'Something went wrong.'}</p>
          ))}

        <div style={{ borderTop: '2px solid var(--cc-border)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 700, minHeight: 44 }}>
            <input
              type="checkbox"
              checked={settings.ear?.enabled !== false}
              onChange={(e) => update('settings', (s) => ({ ...s, ear: { enabled: e.target.checked } }))}
              style={{ width: 24, height: 24 }}
            />
            👂 Check her reading with the ear
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 700, minHeight: 44 }}>
            <input
              type="checkbox"
              checked={settings.aiCoach?.enabled !== false}
              onChange={(e) => update('settings', (s) => ({ ...s, aiCoach: { enabled: e.target.checked } }))}
              style={{ width: 24, height: 24 }}
            />
            ✍️ Write coach notes
          </label>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>
            While the ear is on, each recording is sent to Google&apos;s Gemini API through your own script so it
            can mark the words. Coach notes send only the word counts to Anthropic&apos;s Claude, never the audio.
          </p>
        </div>

        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How to set this up</summary>
          <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.9rem' }}>
            <li>
              Open <code>script.google.com</code> and click &quot;New project&quot;.
            </li>
            <li>
              Delete the sample code and paste in the whole <code>scripts/read-aloud.gs</code> file from this repo.
              Then Project Settings → Script properties → add <code>UPLOAD_SECRET</code> (any long word of your
              own), <code>GEMINI_API_KEY</code> (from Google AI Studio), and <code>ANTHROPIC_API_KEY</code> (from
              the Anthropic console).
            </li>
            <li>
              Click Deploy → New deployment → type Web app. Set &quot;Execute as&quot; to Me and &quot;Who has
              access&quot; to Anyone, then Deploy and authorize when asked. Copy the Web app URL (it ends in{' '}
              <code>/exec</code>).
            </li>
            <li>Paste that URL and the same secret above, then press Test, then &quot;Test ear + coach&quot;.</li>
            <li>
              Later, after pasting a newer version of the script: run the function <code>authorizeOnce</code> once,
              then Deploy → Manage deployments → your existing deployment → ✏️ → New version. Do not create a new
              deployment, or the URL changes.
            </li>
          </ol>
        </details>
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
