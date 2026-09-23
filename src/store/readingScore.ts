// Pure scoring rules for a finished reading take: turns the Gemini "ear"
// result into stars, accuracy, words-per-minute, and up to three tricky
// words to practise. No React, no network - see src/store/ear.ts for the
// side-effecting pipeline that calls scoreTake() with a real EarResult.

import { normalizeWord } from '../content/textSplit'
import type { EarResult, EarResultWord, PassageBest, TakeOutcome, TakeScore, WordStatus } from './progress'

const VALID_STATUSES: ReadonlySet<WordStatus> = new Set(['read', 'skipped', 'stumbled', 'different'])

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Every expected-word index (0..len-1) mapped to its status, defaulting to 'skipped' for anything missing. */
function alignedStatuses(ear: EarResult, len: number): WordStatus[] {
  const out: WordStatus[] = new Array(len).fill('skipped')
  for (const w of ear.words) {
    if (typeof w.i === 'number' && w.i >= 0 && w.i < len) out[w.i] = w.s
  }
  return out
}

/** Last non-skipped index + 1 (0 if every word was skipped, or there are no expected words). */
function computeAttempted(ear: EarResult, len: number): number {
  const statuses = alignedStatuses(ear, len)
  let last = -1
  for (let i = 0; i < len; i++) {
    if (statuses[i] !== 'skipped') last = i
  }
  return last + 1
}

/** Star thresholds for a real attempt: 3 at >=0.90 accuracy, 2 at >=0.70, else 1 - never 0 unless the take itself is noReading/unsure. */
export function starsFor(accuracy: number, outcome: TakeOutcome): 0 | 1 | 2 | 3 {
  if (outcome === 'noReading') return 0
  if (outcome === 'unsure') return 1
  const base: 0 | 1 | 2 | 3 = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1
  if (outcome === 'partial') return Math.min(2, base) as 0 | 1 | 2 | 3
  return base
}

/**
 * Up to `max` words to practise, worst first: different, then skipped, then
 * stumbled (in expected-word order within each bucket), unique by
 * normalized form, only among words within the attempted range. Prefers
 * words at least 3 letters long, falling back to shorter ones only if that
 * leaves fewer than `max`. Words are the passage's own spelling (`expected`),
 * never the (possibly misheard) `heard` text.
 */
export function pickTrickyWords(ear: EarResult, expected: string[], max = 3): string[] {
  const len = expected.length
  const attempted = computeAttempted(ear, len)
  const statuses = alignedStatuses(ear, len)

  const different: number[] = []
  const skipped: number[] = []
  const stumbled: number[] = []
  for (let i = 0; i < attempted; i++) {
    if (statuses[i] === 'different') different.push(i)
    else if (statuses[i] === 'skipped') skipped.push(i)
    else if (statuses[i] === 'stumbled') stumbled.push(i)
  }

  const seen = new Set<string>()
  const longEnough: string[] = []
  const short: string[] = []
  for (const i of [...different, ...skipped, ...stumbled]) {
    const word = expected[i]
    const norm = normalizeWord(word)
    if (norm === '' || seen.has(norm)) continue
    seen.add(norm)
    if (norm.length >= 3) longEnough.push(word)
    else short.push(word)
  }

  const result: string[] = []
  for (const w of longEnough) {
    if (result.length >= max) break
    result.push(w)
  }
  for (const w of short) {
    if (result.length >= max) break
    result.push(w)
  }
  return result
}

/**
 * Scores one take against the passage's expected words (see the plan's
 * section 3 for the full rules). `prevBest` is the passage's current best,
 * if any, used only to decide `newPassageBest`.
 */
export function scoreTake(ear: EarResult, expected: string[], durationSec: number, prevBest?: PassageBest): TakeScore {
  const len = expected.length
  const statuses = alignedStatuses(ear, len)
  const attempted = computeAttempted(ear, len)
  const coverage = len > 0 ? attempted / len : 0

  let read = 0
  let stumbled = 0
  let different = 0
  let skipped = 0
  for (let i = 0; i < attempted; i++) {
    switch (statuses[i]) {
      case 'read':
        read++
        break
      case 'stumbled':
        stumbled++
        break
      case 'different':
        different++
        break
      case 'skipped':
        skipped++
        break
    }
  }

  const accuracy = attempted > 0 ? (read + stumbled) / attempted : 0
  const cleanAccuracy = attempted > 0 ? read / attempted : 0

  const minAttempt = Math.min(3, len)
  const noReading = ear.confidence < 0.35 || attempted < minAttempt

  let outcome: TakeOutcome
  if (noReading) outcome = 'noReading'
  else if (ear.unsure) outcome = 'unsure'
  else if (coverage < 0.6) outcome = 'partial'
  else outcome = 'full'

  const stars = starsFor(accuracy, outcome)

  const clampedSeconds = Math.min(Math.max(ear.readSeconds, 3), Math.max(3, durationSec))
  const rawWcpm = clampedSeconds > 0 ? ((read + stumbled) / clampedSeconds) * 60 : 0
  const wcpm = Math.min(200, Math.round(rawWcpm))

  const smooth = outcome === 'full' && accuracy >= 0.8 ? Math.round(wcpm * accuracy) : 0
  const newPassageBest = smooth > 0 && smooth > (prevBest?.smooth ?? 0) * 1.05

  const trickyWords = outcome === 'noReading' || outcome === 'unsure' ? [] : pickTrickyWords(ear, expected)

  return {
    outcome,
    stars,
    attempted,
    read,
    stumbled,
    different,
    skipped,
    accuracy,
    cleanAccuracy,
    coverage,
    wcpm,
    smooth,
    trickyWords,
    newPassageBest,
  }
}

function tokenizeTranscript(transcript: string): string[] {
  return transcript
    .split(/\s+/)
    .map((w) => normalizeWord(w))
    .filter((w) => w !== '')
}

/**
 * Shapes an untrusted script/Gemini result into an EarResult, or null if the
 * shape is hopeless (no `words` array at all). Aligns `words` by `i` into
 * exactly `expected.length` entries: a missing index becomes a `skipped`
 * entry for that expected word, an out-of-range or duplicate `i` is dropped,
 * and an unrecognized `s` becomes `stumbled`. Sets `unsure` when the
 * per-word alignment looks unreliable (see below), and `at` from the
 * injectable `now` (defaults to Date.now, so tests can pin it).
 */
export function validateEar(raw: unknown, expected: string[], now: () => number = Date.now): EarResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.words)) return null

  const len = expected.length
  const slots: (EarResultWord | undefined)[] = new Array(len).fill(undefined)
  const seenIndices = new Set<number>()
  let returnedCount = 0
  let mismatchCount = 0

  for (const entry of r.words) {
    if (!entry || typeof entry !== 'object') continue
    const w = entry as Record<string, unknown>
    const i = typeof w.i === 'number' ? Math.trunc(w.i) : NaN
    if (!Number.isFinite(i) || i < 0 || i >= len) continue
    if (seenIndices.has(i)) continue
    seenIndices.add(i)

    const text = typeof w.w === 'string' ? w.w : expected[i]
    const rawStatus = w.s
    const status: WordStatus = VALID_STATUSES.has(rawStatus as WordStatus) ? (rawStatus as WordStatus) : 'stumbled'
    const heard = typeof w.heard === 'string' ? w.heard : undefined

    returnedCount++
    if (normalizeWord(text) !== normalizeWord(expected[i])) mismatchCount++

    slots[i] = { i, w: text, s: status, ...(heard !== undefined ? { heard } : {}) }
  }

  for (let i = 0; i < len; i++) {
    if (!slots[i]) slots[i] = { i, w: expected[i], s: 'skipped' }
  }
  const words = slots as EarResultWord[]

  const extraWords = Array.isArray(r.extraWords) ? r.extraWords.filter((x): x is string => typeof x === 'string') : []

  const confidence = clamp01(typeof r.confidence === 'number' ? r.confidence : 0)
  const readSeconds = Math.max(0, typeof r.readSeconds === 'number' && Number.isFinite(r.readSeconds) ? r.readSeconds : 0)
  const transcript = typeof r.transcript === 'string' ? r.transcript : ''

  const mismatchRatio = returnedCount > 0 ? mismatchCount / returnedCount : 0

  const readWords = words.filter((w) => w.s === 'read')
  const transcriptTokens = new Set(tokenizeTranscript(transcript))
  const readWordsFoundInTranscript = readWords.filter((w) => transcriptTokens.has(normalizeWord(w.w))).length
  const transcriptTooThin = readWords.length > 0 && readWordsFoundInTranscript < readWords.length / 2

  const unsure = mismatchRatio > 0.2 || transcriptTooThin

  return {
    words,
    extraWords,
    readSeconds,
    confidence,
    transcript,
    unsure,
    at: now(),
  }
}
