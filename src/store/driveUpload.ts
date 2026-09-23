// Uploads reading takes recorded on this device to the parent's Google
// Drive, via the Apps Script web app in scripts/read-aloud.gs. Nothing here
// blocks the kid: a take is saved locally and rewarded before any of this
// runs. Uploads happen in the background, retry with backoff, and give up
// quietly after enough failed attempts - the take just stays "recorded on
// this device" forever in that case.

import { useSyncExternalStore } from 'react'
import { extensionFor } from '../audio/mime'
import { passageById } from '../content/passages'
import { getDoc, subscribe, update, exportJson, type ReadingTake, type Settings } from './progress'
import { getRecordingStore, type RecordingStore } from './recordings'
import { localDay } from './sessions'

export interface DriveConfig {
  scriptUrl: string
  secret: string
  folderName: string
}

/** True when Settings has enough Drive config to attempt an upload. */
export function isDriveConfigured(settings: Settings): settings is Settings & { driveUpload: DriveConfig } {
  const cfg = settings.driveUpload
  return !!cfg && cfg.scriptUrl.trim() !== '' && cfg.secret.trim() !== ''
}

const DEVICE_ID_KEY = 'readaloud.deviceId'

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

/** The stable per-device id used to tell "recorded on this device" apart from other devices. */
export function getDeviceId(): string {
  if (!hasLocalStorage()) return 'unknown-device'
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const fresh = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(DEVICE_ID_KEY, fresh)
    return fresh
  } catch {
    return 'unknown-device'
  }
}

/** Marks a take for upload. No-op if the take doesn't exist or already finished uploading. */
export function enqueueUpload(takeId: string): void {
  update('reading', (reading) => {
    const take = reading.takes.find((t) => t.id === takeId)
    if (!take || take.upload?.status === 'done') return reading
    return {
      ...reading,
      takes: reading.takes.map((t) =>
        t.id === takeId ? { ...t, upload: { status: 'pending', attempts: 0, updatedAt: Date.now() } } : t,
      ),
    }
  })
}

/** Sets every 'failed' take back to 'pending' with a clean attempt count, so the queue retries them right away. */
export function retryFailedUploads(): void {
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) =>
      t.upload?.status === 'failed'
        ? { ...t, upload: { status: 'pending', attempts: 0, updatedAt: Date.now() } }
        : t,
    ),
  }))
}

export interface UploadDeps {
  fetch?: typeof fetch
  store?: RecordingStore
  now?: () => number
  online?: () => boolean
  deviceId?: string
}

const BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000]
const MAX_ATTEMPTS = 8
const STALE_UPLOADING_MS = 10 * 60_000

function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
}

function defaultOnline(): boolean {
  try {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine
  } catch {
    return true
  }
}

function passageTitle(passageId: string, settings: Settings): string {
  return passageById(passageId, settings.customPassages)?.title ?? 'Story'
}

/** `YYYY-MM-DD_HHmm_<slug>.<ext>` from the take's local start time and passage title. */
export function buildFileName(take: ReadingTake, title: string): string {
  const d = new Date(take.startedAt)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const base = title.trim() !== '' ? title : 'story'
  const slug =
    base
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'story'
  const ext = extensionFor(take.mimeType)
  return `${y}-${mo}-${day}_${hh}${mm}_${slug}.${ext}`
}

/** Chunked base64 encoding so a large ArrayBuffer doesn't blow the call stack via `String.fromCharCode(...bytes)`. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/** Same UTF-8-safe chunked encoding as arrayBufferToBase64, for a JS string (kidName etc. may not be ASCII). */
function stringToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return arrayBufferToBase64(bytes.buffer as ArrayBuffer)
}

interface UploadResponse {
  ok: boolean
  fileId?: string
  url?: string
  downloadUrl?: string
  error?: string
}

let uploading = false

/**
 * Walks every eligible take once, uploading them one at a time, sequentially.
 * Re-entrant calls while a run is already in progress are ignored - the
 * in-flight run will pick up anything new next pass (called again on a
 * timer / online event by startUploadWorker).
 *
 * A candidate is any take recorded on this device that still has its local
 * audio and hasn't finished uploading - including a take with no `upload`
 * field at all (recorded before Drive was configured, or otherwise never
 * enqueued) and a take explicitly marked 'pending'/'uploading'. A take
 * that's given up ('failed') is skipped here; it only comes back via
 * retryFailedUploads() or uploadNow().
 */
export async function processUploadQueue(deps: UploadDeps = {}): Promise<void> {
  if (uploading) return
  const settings = getDoc().settings
  if (!isDriveConfigured(settings)) return
  const online = deps.online ?? defaultOnline
  if (!online()) return

  uploading = true
  try {
    const now = deps.now ?? Date.now
    const doFetch = deps.fetch ?? fetch
    const store = deps.store ?? getRecordingStore()
    const deviceId = deps.deviceId ?? getDeviceId()

    // Snapshot candidate ids up front; the doc is re-read before each write
    // since takes may change while we're awaiting a fetch.
    const nowMs = now()
    const candidateIds = getDoc()
      .reading.takes.filter((t) => {
        if (t.deviceId !== deviceId || !t.hasAudio) return false
        const upload = t.upload
        if (!upload) return true
        if (upload.status === 'pending') {
          if (upload.attempts > 0 && nowMs - upload.updatedAt < backoffMs(upload.attempts)) return false
          return true
        }
        if (upload.status === 'uploading') {
          return nowMs - upload.updatedAt >= STALE_UPLOADING_MS
        }
        return false
      })
      .map((t) => t.id)

    for (const takeId of candidateIds) {
      await uploadOne(takeId, { doFetch, store, now, cfg: settings.driveUpload })
    }
  } finally {
    uploading = false
  }
}

function setTakeUpload(takeId: string, upload: NonNullable<ReadingTake['upload']>): void {
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => (t.id === takeId ? { ...t, upload } : t)),
  }))
}

async function uploadOne(
  takeId: string,
  ctx: { doFetch: typeof fetch; store: RecordingStore; now: () => number; cfg: DriveConfig },
): Promise<void> {
  const { doFetch, store, now, cfg } = ctx
  const doc = getDoc()
  const take = doc.reading.takes.find((t) => t.id === takeId)
  if (!take) return
  // A take with no `upload` field yet (recorded before Drive was
  // configured, or otherwise never enqueued) starts fresh, same as a
  // freshly-enqueued pending upload.
  const currentUpload = take.upload ?? { status: 'pending' as const, attempts: 0, updatedAt: now() }

  // attempts >= MAX_ATTEMPTS -> give up.
  if (currentUpload.attempts >= MAX_ATTEMPTS) {
    setTakeUpload(takeId, { ...currentUpload, status: 'failed', lastError: 'gave up', updatedAt: now() })
    return
  }

  const blob = await store.get(takeId)
  if (!blob) {
    setTakeUpload(takeId, { ...currentUpload, status: 'failed', lastError: 'no local audio', updatedAt: now() })
    return
  }

  setTakeUpload(takeId, { ...currentUpload, status: 'uploading', updatedAt: now() })

  const settings = getDoc().settings
  const title = passageTitle(take.passageId, settings)
  const fileName = buildFileName(take, title)
  const stars = take.score?.stars ?? 0
  const description = `${settings.kidName} · ${title} · ${stars} star${stars === 1 ? '' : 's'}`

  try {
    const dataBase64 = arrayBufferToBase64(await blob.arrayBuffer())
    const res = await doFetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({
        secret: cfg.secret,
        folderName: cfg.folderName,
        fileName,
        mimeType: take.mimeType,
        description,
        dataBase64,
      }),
    })
    let parsed: UploadResponse | null = null
    try {
      parsed = (await res.json()) as UploadResponse
    } catch {
      parsed = null
    }

    const latest = getDoc().reading.takes.find((t) => t.id === takeId)
    if (!latest || !latest.upload) return

    if (parsed?.ok) {
      setTakeUpload(takeId, {
        status: 'done',
        attempts: latest.upload.attempts,
        driveFileId: parsed.fileId,
        driveUrl: parsed.downloadUrl ?? parsed.url,
        updatedAt: now(),
      })
    } else {
      const lastError = parsed?.error ?? `HTTP ${res.status}`
      setTakeUpload(takeId, {
        status: 'pending',
        attempts: latest.upload.attempts + 1,
        lastError,
        updatedAt: now(),
      })
    }
  } catch (err) {
    const latest = getDoc().reading.takes.find((t) => t.id === takeId)
    if (!latest || !latest.upload) return
    setTakeUpload(takeId, {
      status: 'pending',
      attempts: latest.upload.attempts + 1,
      lastError: err instanceof Error ? err.message : 'network error',
      updatedAt: now(),
    })
  }
}

/** Derived counts of this device's takes by upload status, for the Settings summary chip. */
export function useUploadSummary(): { pending: number; failed: number; done: number } {
  return useSyncExternalStore(subscribe, getUploadSummarySnapshot, getUploadSummarySnapshot)
}

// useSyncExternalStore needs a referentially stable snapshot while nothing
// changed, so the summary is cached against the takes array identity.
let summaryForTakes: ReadingTake[] | null = null
let summaryCache: { pending: number; failed: number; done: number } = { pending: 0, failed: 0, done: 0 }

export function getUploadSummarySnapshot(): { pending: number; failed: number; done: number } {
  const takes = getDoc().reading.takes
  if (takes === summaryForTakes) return summaryCache
  let pending = 0
  let failed = 0
  let done = 0
  for (const t of takes) {
    if (t.upload?.status === 'pending' || t.upload?.status === 'uploading') pending += 1
    else if (t.upload?.status === 'failed') failed += 1
    else if (t.upload?.status === 'done') done += 1
  }
  summaryForTakes = takes
  summaryCache = { pending, failed, done }
  return summaryCache
}

/** Settings "Test" button: pings the script with the given config, without touching any take. */
export async function testDriveConnection(
  cfg: DriveConfig,
  deps: Pick<UploadDeps, 'fetch'> = {},
): Promise<{ ok: boolean; message: string }> {
  const doFetch = deps.fetch ?? fetch
  if (cfg.scriptUrl.trim() === '' || cfg.secret.trim() === '') {
    return { ok: false, message: 'Enter a script URL and secret first.' }
  }
  try {
    const res = await doFetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ secret: cfg.secret, ping: true }),
    })
    let parsed: { ok?: boolean; pong?: boolean; error?: string } | null = null
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    if (parsed?.ok && parsed.pong) return { ok: true, message: 'Connected! Drive is ready.' }
    if (parsed?.error) return { ok: false, message: parsed.error }
    return { ok: false, message: `Could not connect (HTTP ${res.status}).` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reach that URL.' }
  }
}

/**
 * "☁️ Upload now" / "Try again": clears whatever backoff or give-up state is
 * blocking a take (or, with no id, every 'pending'/'uploading' take) and
 * kicks the queue right away, instead of waiting for the next timer tick.
 * Works on a 'failed' take too - that's exactly what the "Try again" chip
 * button needs - and on a take with no `upload` field yet.
 */
export async function uploadNow(takeId?: string, deps: UploadDeps = {}): Promise<void> {
  const now = deps.now ?? Date.now
  const nowMs = now()

  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => {
      if (t.upload?.status === 'done') return t
      if (takeId) {
        return t.id === takeId ? { ...t, upload: { status: 'pending', attempts: 0, updatedAt: nowMs } } : t
      }
      return t.upload && (t.upload.status === 'pending' || t.upload.status === 'uploading')
        ? { ...t, upload: { status: 'pending', attempts: 0, updatedAt: nowMs } }
        : t
    }),
  }))

  await processUploadQueue(deps)
}

// ---------------------------------------------------------------------------
// Daily progress backup to Drive
//
// A second, independent backup of the whole progress doc (settings,
// profile, rewards, streaks, reading metadata - everything exportJson()
// carries), uploaded to the same Drive folder as reading takes once per
// local day. If the gist sync token is ever lost, revoked, or just never set
// up on a second device, a Drive folder the parent already has open still
// holds a same-day copy.
// ---------------------------------------------------------------------------

const PROGRESS_BACKUP_DAY_KEY = 'readaloud.drive.progressBackupDay'

/** The local day (YYYY-MM-DD) the progress doc was last successfully backed up to Drive, or null if never. */
export function lastProgressBackupDay(): string | null {
  if (!hasLocalStorage()) return null
  try {
    return localStorage.getItem(PROGRESS_BACKUP_DAY_KEY)
  } catch {
    return null
  }
}

function setLastProgressBackupDay(day: string): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(PROGRESS_BACKUP_DAY_KEY, day)
  } catch {
    // Storage full/disabled - the next tick just retries the same day, which is harmless.
  }
}

/**
 * Uploads the current progress export to Drive if it hasn't been done yet
 * today (by local day). A no-op when Drive isn't configured, offline, or
 * already backed up today. Only marks the day done once the script confirms
 * success, so a failed attempt is retried on the very next tick rather than
 * silently skipped for the rest of the day.
 */
export async function backupProgressToDrive(deps: UploadDeps = {}): Promise<void> {
  const settings = getDoc().settings
  if (!isDriveConfigured(settings)) return
  const online = deps.online ?? defaultOnline
  if (!online()) return

  const now = deps.now ?? Date.now
  const today = localDay(new Date(now()))
  if (lastProgressBackupDay() === today) return

  const doFetch = deps.fetch ?? fetch
  const cfg = settings.driveUpload
  const fileName = `readaloud-progress-${today}.json`
  const description = `${settings.kidName} · daily progress backup`

  try {
    const res = await doFetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({
        secret: cfg.secret,
        folderName: cfg.folderName,
        fileName,
        mimeType: 'application/json',
        description,
        dataBase64: stringToBase64(exportJson()),
      }),
    })
    let parsed: UploadResponse | null = null
    try {
      parsed = (await res.json()) as UploadResponse
    } catch {
      parsed = null
    }
    if (parsed?.ok) setLastProgressBackupDay(today)
  } catch {
    // A network hiccup just means the next tick (or a fresh day) retries; nothing to roll back.
  }
}

/**
 * Installs a 30s timer plus an `online` listener that call
 * processUploadQueue() and backupProgressToDrive(). Returns a disposer.
 * Guards every browser global so this is a safe no-op when imported in node
 * (tests, SSR).
 */
export function startUploadWorker(): () => void {
  if (typeof window === 'undefined') return () => {}

  const tick = () => {
    void processUploadQueue()
    void backupProgressToDrive()
  }
  const interval = window.setInterval(tick, 30_000)
  window.addEventListener('online', tick)
  tick()

  return () => {
    window.clearInterval(interval)
    window.removeEventListener('online', tick)
  }
}
