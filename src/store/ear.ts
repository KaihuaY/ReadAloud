// The "ear": sends a finished take's audio plus the passage words to the
// parent's Apps Script, which asks Gemini to mark every word read /
// stumbled / different / skipped (see the plan's section 3). Never throws -
// every failure just leaves the take's `earStatus` as 'failed' so the
// parent review screen can offer "Try again".

import { useSyncExternalStore } from 'react'
import { tokenizeWords } from '../content/textSplit'
import { passageById } from '../content/passages'
import { arrayBufferToBase64, isDriveConfigured, type DriveConfig } from './driveUpload'
import { getDoc } from './progress'
import { getRecordingStore } from './recordings'
import { awardPassageBestIfBeaten, isWordTake, setTakeEar, setTakeEarStatus, setTakeScore, wordOfTake } from './reading'
import { scoreTake, validateEar } from './readingScore'
import { requestReadingFeedback } from './readingCoach'
import { setRecordsBeaten, updateRecords } from './records'
import { awardNewBadges } from './badges'
import { recordPractice } from './trickyWords'

export type EarStage = 'idle' | 'encoding' | 'listening' | 'done' | 'failed'

const stages = new Map<string, EarStage>()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setEarStage(takeId: string, stage: EarStage): void {
  stages.set(takeId, stage)
  for (const l of listeners) l()
}

export function getEarStage(takeId: string): EarStage {
  return stages.get(takeId) ?? 'idle'
}

/** React hook: where a take is in the listening pipeline. */
export function useEarStage(takeId: string): EarStage {
  return useSyncExternalStore(
    subscribe,
    () => getEarStage(takeId),
    () => getEarStage(takeId),
  )
}

export interface EarDeps {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const EAR_TIMEOUT_MS = 45_000
const RETRY_DELAY_MS = 8_000

function isRetryableReason(reason: string): boolean {
  return reason === 'network' || reason === 'timeout' || reason === 'cap' || /^http-5\d\d$/.test(reason)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ReadCallOk {
  ok: true
  result: unknown
}
interface ReadCallFail {
  ok: false
  reason: string
}
type ReadCallResult = ReadCallOk | ReadCallFail

interface ReadPayload {
  passageId: string
  words: string[]
  durationSec: number
  mimeType: string
  dataBase64: string
}

async function callReadScript(cfg: DriveConfig, payload: ReadPayload, doFetch: typeof fetch): Promise<ReadCallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EAR_TIMEOUT_MS)
  try {
    const res = await doFetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: controller.signal,
      body: JSON.stringify({ secret: cfg.secret, action: 'read', ...payload }),
    })
    if (!res.ok) return { ok: false, reason: `http-${res.status}` }

    let body: { ok?: boolean; result?: unknown; reason?: string } | null = null
    try {
      body = (await res.json()) as { ok?: boolean; result?: unknown; reason?: string }
    } catch {
      return { ok: false, reason: 'bad-json' }
    }
    if (!body || body.ok !== true) return { ok: false, reason: body?.reason ?? 'bad-json' }
    return { ok: true, result: body.result }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return { ok: false, reason: isAbort ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** Never throws. Fire-and-forget from recordingSession after a take is saved, or from retryEar/retryPendingEars. */
export async function requestEar(takeId: string, blob: Blob, deps: EarDeps = {}): Promise<void> {
  try {
    const doc = getDoc()
    const take = doc.reading.takes.find((t) => t.id === takeId)
    if (!take) return

    const settings = doc.settings
    const wordTake = isWordTake(take)
    const word = wordTake ? wordOfTake(take.passageId) : null
    const passage = wordTake ? undefined : passageById(take.passageId, settings.customPassages)

    if ((wordTake ? !word : !passage) || settings.ear?.enabled === false || !isDriveConfigured(settings)) {
      setTakeEarStatus(takeId, 'failed')
      setEarStage(takeId, 'failed')
      return
    }

    setTakeEarStatus(takeId, 'pending')
    setEarStage(takeId, 'encoding')

    const words = wordTake ? [word as string] : tokenizeWords(passage!.text).map((t) => t.norm)
    const dataBase64 = arrayBufferToBase64(await blob.arrayBuffer())
    const mimeType = blob.type || take.mimeType

    setEarStage(takeId, 'listening')

    const doFetch = deps.fetch ?? fetch
    const sleep = deps.sleep ?? defaultSleep
    const payload: ReadPayload = { passageId: take.passageId, words, durationSec: take.durationSec, mimeType, dataBase64 }

    let result = await callReadScript(settings.driveUpload, payload, doFetch)
    if (!result.ok && isRetryableReason(result.reason)) {
      await sleep(RETRY_DELAY_MS)
      result = await callReadScript(settings.driveUpload, payload, doFetch)
    }

    if (!result.ok) {
      setTakeEarStatus(takeId, 'failed')
      setEarStage(takeId, 'failed')
      return
    }

    const ear = validateEar(result.result, words, deps.now)
    if (!ear) {
      setTakeEarStatus(takeId, 'failed')
      setEarStage(takeId, 'failed')
      return
    }

    setTakeEar(takeId, ear)

    if (wordTake) {
      const score = scoreTake(ear, words, take.durationSec, undefined)
      setTakeScore(takeId, score)
      // Word takes are practice, not reads: no passage best, no coach note -
      // just the tricky-word tally (ok when the word was read or stumbled).
      recordPractice(word as string, score.outcome === 'full' && score.read + score.stumbled >= 1)
    } else {
      const prevBest = getDoc().reading.passageBests[take.passageId]
      const score = scoreTake(ear, words, take.durationSec, prevBest)
      setTakeScore(takeId, score)
      awardPassageBestIfBeaten(takeId)

      // The coach writes its notes from the score alone; it never blocks the ear.
      void requestReadingFeedback(takeId)
    }

    // Records and badges only ever consider real passage takes (see
    // reading.ts's passageTakes()) - safe to call for a word take too, since
    // it will simply find nothing new to report.
    const beaten = updateRecords()
    setRecordsBeaten(takeId, beaten)
    awardNewBadges()

    setEarStage(takeId, 'done')
  } catch {
    setTakeEarStatus(takeId, 'failed')
    setEarStage(takeId, 'failed')
  }
}

/** Re-runs the ear for a saved take, reloading its audio from IndexedDB. */
export async function retryEar(takeId: string, deps: EarDeps = {}): Promise<void> {
  const blob = await getRecordingStore().get(takeId)
  if (!blob) {
    setTakeEarStatus(takeId, 'failed')
    setEarStage(takeId, 'failed')
    return
  }
  await requestEar(takeId, blob, deps)
}

let onlineListenerRegistered = false

/** Retries every take still marked earStatus 'pending' (app start, back online). */
export async function retryPendingEars(deps: EarDeps = {}): Promise<void> {
  if (!onlineListenerRegistered && typeof window !== 'undefined') {
    onlineListenerRegistered = true
    window.addEventListener('online', () => {
      void retryPendingEars()
    })
  }

  const pending = getDoc().reading.takes.filter((t) => t.earStatus === 'pending' && t.hasAudio)
  for (const t of pending) {
    await retryEar(t.id, deps)
  }
}
