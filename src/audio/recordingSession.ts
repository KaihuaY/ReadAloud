// Module-level singleton store for the in-progress reading take: plain
// get/subscribe functions plus a React hook built on useSyncExternalStore.
// Owns the whole start -> recording -> stop -> saved lifecycle so the Read
// screen just renders state.

import { useSyncExternalStore } from 'react'
import { ActivityMeter } from './activityMeter'
import { BrowserAudioBackend } from './browserBackend'
import { FakeAudioBackend, FAKE_PIANO_SCRIPT } from './fakeBackend'
import { computeWaveform } from './waveform'
import { MicStartError, type AudioBackend, type MicError, type MicSession, type RecordingResult } from './types'
import { acquireWakeLock, type WakeLockHandle } from './wakeLock'
import { getDeviceId, awardReadIfGoalReached, isWordTake, saveTake, setTakeWaveform } from '../store/reading'
import { getDoc, type ReadingTake } from '../store/progress'
import { getRecordingStore, requestPersistentStorage } from '../store/recordings'
import { isDriveConfigured, processUploadQueue } from '../store/driveUpload'
import { requestEar } from '../store/ear'
import { localDay } from '../store/sessions'
import { fireConfetti } from '../components/Confetti'
import { awardNewBadges } from '../store/badges'

export type SessionState =
  | { status: 'idle' }
  | { status: 'starting'; passageId: string }
  | {
      status: 'recording'
      passageId: string
      startedAt: number
      wallSec: number
      activeSec: number
      level: number
      silentSec: number
      wakeLock: boolean
      hearing: boolean
    }
  | { status: 'saving' }
  | {
      status: 'done'
      take: ReadingTake
      goalJustReached: boolean
      discarded: boolean
    }
  | { status: 'error'; error: MicError }

const FAKE_MIC_FLAG_KEY = 'readaloud.fakeMic'
const MIN_KEPT_DURATION_SEC = 3
/** Word-practice takes ("Try just this word") are much shorter by nature - a 1s floor instead of 3s. */
const MIN_KEPT_DURATION_SEC_WORD = 1
const CHECKPOINT_INTERVAL_MS = 1000
const INFLIGHT_KEY = 'readaloud.reading.inflight'

/** Written to sessionStorage roughly once a second while recording, so a reload can estimate active-minutes for a take recovered from leftover partial chunks (see recoverUnfinishedTakes). */
interface InflightCheckpoint {
  id: string
  activeMs: number
  startedAt: number
  passageId: string
  listenedFirst?: boolean
}

function readInflightCheckpoint(): InflightCheckpoint | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(INFLIGHT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as InflightCheckpoint
  } catch {
    return null
  }
}

function writeInflightCheckpoint(cp: InflightCheckpoint): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(INFLIGHT_KEY, JSON.stringify(cp))
  } catch {
    // Storage disabled/full - the recovered take (if any) just falls back to activeSec 0.
  }
}

function clearInflightCheckpoint(): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.removeItem(INFLIGHT_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through to the manual fallback below
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** ?fakeMic=1 in dev enables the scripted backend for laptop testing without a mic; sticks for the session via localStorage. */
function isDevFakeMicRequested(): boolean {
  if (typeof window === 'undefined') return false
  let fromHash = false
  try {
    fromHash = window.location.hash.includes('fakeMic=1')
  } catch {
    fromHash = false
  }
  if (fromHash) {
    try {
      localStorage.setItem(FAKE_MIC_FLAG_KEY, '1')
    } catch {
      // ignore - just won't stick across a reload
    }
    return true
  }
  try {
    return localStorage.getItem(FAKE_MIC_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function createDefaultBackend(): AudioBackend {
  if (import.meta.env.DEV && isDevFakeMicRequested()) {
    return new FakeAudioBackend(FAKE_PIANO_SCRIPT)
  }
  return new BrowserAudioBackend()
}

let backend: AudioBackend = createDefaultBackend()

export function setAudioBackend(b: AudioBackend): void {
  backend = b
}

export function getAudioBackend(): AudioBackend {
  return backend
}

let state: SessionState = { status: 'idle' }
const listeners = new Set<() => void>()

function setState(next: SessionState): void {
  state = next
  for (const l of listeners) l()
}

/** Plain (non-hook) read of the current session state - for code outside React, including tests. */
export function getSessionState(): SessionState {
  return state
}

export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useRecordingSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSessionState, getSessionState)
}

export function isRecordingActive(s: SessionState): boolean {
  return s.status === 'starting' || s.status === 'recording' || s.status === 'saving'
}

// --- In-progress session bookkeeping ---------------------------------------

let currentSession: MicSession | null = null
let currentMeter: ActivityMeter | null = null
let unsubscribeLevel: (() => void) | null = null
let unsubscribeChunk: (() => void) | null = null
let currentWakeLock: WakeLockHandle | null = null
let currentPassageId: string | null = null
let currentStartedAt = 0
let currentTakeId: string | null = null
let currentListenedFirst = false
let hiddenListenersAttached = false
let autoStopTimer: ReturnType<typeof setTimeout> | null = null

function clearAutoStopTimer(): void {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer)
    autoStopTimer = null
  }
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    void stopTake('hidden')
  }
}

function onPageHide(): void {
  void stopTake('hidden')
}

function attachHiddenListeners(): void {
  if (hiddenListenersAttached) return
  hiddenListenersAttached = true
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)
}

function detachHiddenListeners(): void {
  if (!hiddenListenersAttached) return
  hiddenListenersAttached = false
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
}

function resetTrackingState(): void {
  currentSession = null
  currentMeter = null
  unsubscribeLevel = null
  unsubscribeChunk = null
  if (currentWakeLock) {
    currentWakeLock.release()
    currentWakeLock = null
  }
}

/** Fire-and-forget: a lost chunk just means a slightly smaller recovered take later, never worth blocking or surfacing an error over. */
async function persistPartialChunk(
  id: string,
  blob: Blob,
  seq: number,
  mimeType: string,
  startedAt: number,
  passageId: string,
): Promise<void> {
  try {
    const bytes = await blob.arrayBuffer()
    await getRecordingStore().putPartial({ id, seq, bytes, mimeType, startedAt, passageId, deviceId: getDeviceId() })
  } catch {
    // Best-effort only - see comment above.
  }
}

/**
 * Must be invoked directly from a tap handler (Safari requires the mic
 * prompt inside a user gesture). The recording always auto-stops after
 * `settings.maxRecordSeconds`, unless `opts.maxSeconds` is given (Tricky
 * words' "Try just this word" passes 8, overriding the settings value).
 */
export async function startTake(passageId: string, opts?: { listenedFirst?: boolean; maxSeconds?: number }): Promise<void> {
  if (isRecordingActive(state)) return

  // Best-effort and fire-and-forget: browsers that condition the grant on a
  // user gesture still see one here (startTake must be called synchronously
  // from a tap handler - see the doc comment below).
  void requestPersistentStorage()

  currentPassageId = passageId
  currentListenedFirst = opts?.listenedFirst ?? false
  const takeId = randomId()
  currentTakeId = takeId
  setState({ status: 'starting', passageId })

  try {
    const session = await backend.start()
    currentSession = session
    currentStartedAt = Date.now()
    const meter = new ActivityMeter()
    currentMeter = meter
    currentWakeLock = await acquireWakeLock()
    const wakeLockOn = currentWakeLock.supported

    setState({
      status: 'recording',
      passageId,
      startedAt: currentStartedAt,
      wallSec: 0,
      activeSec: 0,
      level: 0,
      silentSec: 0,
      wakeLock: wakeLockOn,
      hearing: false,
    })

    const maxSeconds = opts?.maxSeconds ?? getDoc().settings.maxRecordSeconds
    autoStopTimer = setTimeout(() => void stopTake('user'), maxSeconds * 1000)

    if (session.onChunk) {
      unsubscribeChunk = session.onChunk((blob, seq) => {
        void persistPartialChunk(takeId, blob, seq, session.mimeType, currentStartedAt, passageId)
      })
    }

    let lastCheckpointAt = 0
    let lastEmittedAt = 0
    let lastEmittedHearing = false
    unsubscribeLevel = session.onLevel((rms, t) => {
      const frame = meter.push(rms, t)
      if (state.status !== 'recording') return
      const nowMs = Date.now()
      // Throttled to ~5 Hz so the Read screen stays cheap on the iPad -
      // except a hearing flip (the chip's text/color changing), which
      // always emits immediately so that feedback never feels laggy.
      const hearingChanged = frame.active !== lastEmittedHearing
      if (hearingChanged || nowMs - lastEmittedAt >= 200) {
        lastEmittedAt = nowMs
        lastEmittedHearing = frame.active
        setState({
          status: 'recording',
          passageId,
          startedAt: currentStartedAt,
          wallSec: (nowMs - currentStartedAt) / 1000,
          activeSec: Math.round(frame.activeMs / 1000),
          level: frame.level,
          silentSec: Math.round(frame.silentMs / 1000),
          wakeLock: wakeLockOn,
          hearing: frame.active,
        })
      }
      if (nowMs - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
        lastCheckpointAt = nowMs
        writeInflightCheckpoint({ id: takeId, activeMs: frame.activeMs, startedAt: currentStartedAt, passageId, listenedFirst: currentListenedFirst })
      }
    })

    attachHiddenListeners()
  } catch (err) {
    const kind = err instanceof MicStartError ? err.kind : 'unknown'
    currentTakeId = null
    clearAutoStopTimer()
    resetTrackingState()
    setState({ status: 'error', error: kind })
  }
}

export async function stopTake(reason: 'user' | 'hidden' = 'user'): Promise<void> {
  void reason // kept for API clarity/future use; behavior is identical either way
  if (state.status !== 'recording') return

  const passageId = currentPassageId
  const startedAt = currentStartedAt
  const session = currentSession
  const meter = currentMeter
  const takeId = currentTakeId
  const listenedFirst = currentListenedFirst
  clearAutoStopTimer()

  detachHiddenListeners()
  if (unsubscribeLevel) {
    unsubscribeLevel()
    unsubscribeLevel = null
  }
  if (unsubscribeChunk) {
    unsubscribeChunk()
    unsubscribeChunk = null
  }

  setState({ status: 'saving' })

  let result: RecordingResult = { blob: null, mimeType: '', durationMs: 0 }
  if (session) {
    try {
      result = await session.stop()
    } catch {
      // Keep whatever we already tracked locally and still finish the flow
      // with an empty result rather than getting stuck in 'saving'.
    }
  }

  resetTrackingState()

  // Seconds the mic heard something above its noise floor - the ear uses it
  // to skip takes that are pure silence (a speech model asked about silence
  // can invent a perfect read).
  const activeSec = Math.round((meter?.activeMs ?? 0) / 1000)
  const durationSec = Math.max(0, Math.round(result.durationMs / 1000))
  const day = localDay()
  const settings = getDoc().settings

  const take: ReadingTake = {
    id: takeId ?? randomId(),
    day,
    passageId: passageId ?? '',
    startedAt,
    durationSec,
    activeSec,
    ...(listenedFirst ? { listenedFirst: true } : {}),
    mimeType: result.mimeType,
    sizeBytes: result.blob?.size ?? 0,
    hasAudio: Boolean(result.blob && result.blob.size > 0),
    deviceId: getDeviceId(),
    upload: isDriveConfigured(settings) ? { status: 'pending', attempts: 0, updatedAt: Date.now() } : undefined,
  }

  const wordTake = isWordTake({ passageId: passageId ?? '' })
  const minKeptDurationSec = wordTake ? MIN_KEPT_DURATION_SEC_WORD : MIN_KEPT_DURATION_SEC
  const discarded = durationSec < minKeptDurationSec
  let goalJustReached = false

  if (!discarded) {
    if (result.blob) {
      try {
        await getRecordingStore().put(take.id, result.blob)
      } catch {
        take.hasAudio = false
      }
    }
    saveTake(take)
    // Word-practice takes ("Try just this word") are practice, not a read -
    // they never count toward the daily goal or its streak.
    if (!wordTake) {
      goalJustReached = awardReadIfGoalReached(day)
      if (goalJustReached) fireConfetti('big')
      awardNewBadges()
    }
    // Kick the Drive upload right away; the worker also retries later.
    if (take.upload) void processUploadQueue()

    // Fire-and-forget: the waveform is a nice-to-have for the player, never
    // worth making the kid wait on the done screen for a decode that can be
    // slow (or fail outright) on some recordings.
    if (result.blob && take.hasAudio) {
      const blobForWaveform = result.blob
      void computeWaveform(blobForWaveform).then((waveform) => {
        if (waveform) setTakeWaveform(take.id, waveform)
      })

      // Fire-and-forget, same reasoning as the waveform above: the Gemini
      // "ear" pass is a nice-to-have that must never hold up the done
      // screen. requestEar never throws (Phase 1 replaces the current stub).
      void requestEar(take.id, blobForWaveform)
    }
  }

  // The take is finalized one way or another now (saved, or deliberately
  // discarded) - the partial chunks and inflight checkpoint that existed
  // only to survive a crash/reload mid-recording are no longer needed.
  // Awaited (unlike the fire-and-forget writes above) so a reload right
  // after Stop can never race a leftover partial into recoverUnfinishedTakes.
  if (takeId) {
    try {
      await getRecordingStore().deletePartial(takeId)
    } catch {
      // Not fatal - a stray partial just gets swept up (harmlessly) by the next recoverUnfinishedTakes() call.
    }
  }
  clearInflightCheckpoint()
  currentTakeId = null
  currentPassageId = null
  currentListenedFirst = false

  setState({ status: 'done', take, goalJustReached, discarded })
}

export function dismiss(): void {
  if (state.status === 'done' || state.status === 'error' || state.status === 'idle') {
    setState({ status: 'idle' })
  }
}

// --- Recovering a take that never made it through a clean stopTake() -------
//
// If the app crashes, the tab is force-closed, or an update reloads mid
// recording (shouldn't happen with registerType 'prompt', but this is the
// safety net), stopTake()'s cleanup never runs and its partial chunks are
// left behind in IndexedDB. Call this once on startup (see main.tsx) to
// assemble any of those into a real take.

let recoveredTakeCount = 0
const recoveredTakeListeners = new Set<() => void>()

function setRecoveredTakeCount(n: number): void {
  recoveredTakeCount = n
  for (const l of recoveredTakeListeners) l()
}

function subscribeRecoveredTakeCount(cb: () => void): () => void {
  recoveredTakeListeners.add(cb)
  return () => recoveredTakeListeners.delete(cb)
}

function getRecoveredTakeCountSnapshot(): number {
  return recoveredTakeCount
}

/** Count of unfinished takes recovered by the most recent recoverUnfinishedTakes() call - for a small "we saved an unfinished recording" notice. */
export function useRecoveredTakeNotice(): number {
  return useSyncExternalStore(subscribeRecoveredTakeCount, getRecoveredTakeCountSnapshot, getRecoveredTakeCountSnapshot)
}

/**
 * Assembles every leftover partial recording into a real take, saves it
 * locally (queued for Drive upload if configured), and clears the partial
 * chunks either way. Safe to call every app start - a normal
 * startTake -> stopTake cycle never leaves partials behind, so there is
 * usually nothing to do. Returns how many takes were recovered.
 */
export async function recoverUnfinishedTakes(): Promise<number> {
  const store = getRecordingStore()
  let ids: string[]
  try {
    ids = await store.listPartialIds()
  } catch {
    return 0
  }
  if (ids.length === 0) return 0

  const existingIds = new Set(getDoc().reading.takes.map((t) => t.id))
  const checkpoint = readInflightCheckpoint()
  let recovered = 0

  for (const id of ids) {
    if (existingIds.has(id)) {
      await store.deletePartial(id).catch(() => {})
      continue
    }

    let assembled: Awaited<ReturnType<typeof store.assemblePartial>> = null
    try {
      assembled = await store.assemblePartial(id)
    } catch {
      assembled = null
    }
    if (!assembled || !assembled.passageId) {
      await store.deletePartial(id).catch(() => {})
      continue
    }

    const { blob, mimeType, startedAt, passageId, chunks } = assembled
    const matchingCheckpoint = checkpoint && checkpoint.id === id ? checkpoint : null
    const settings = getDoc().settings
    const take: ReadingTake = {
      id,
      day: localDay(new Date(startedAt)),
      passageId,
      startedAt,
      durationSec: chunks, // ~1 chunk per second - see AssembledPartial's doc comment
      ...(matchingCheckpoint ? { activeSec: Math.round(matchingCheckpoint.activeMs / 1000) } : {}),
      ...(matchingCheckpoint?.listenedFirst ? { listenedFirst: true } : {}),
      mimeType,
      sizeBytes: blob.size,
      hasAudio: true,
      deviceId: getDeviceId(),
      upload: isDriveConfigured(settings) ? { status: 'pending', attempts: 0, updatedAt: Date.now() } : undefined,
    }

    try {
      await getRecordingStore().put(take.id, blob)
      saveTake(take)
      if (take.upload) void processUploadQueue()
      recovered += 1
    } catch {
      // Couldn't save the blob locally - nothing more useful to do with this partial.
    }
    await store.deletePartial(id).catch(() => {})
  }

  clearInflightCheckpoint()
  if (recovered > 0) setRecoveredTakeCount(recovered)
  return recovered
}
