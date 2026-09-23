// The AI reading coach: turns a scored take into two written notes (a short
// one read aloud to the kid, a fuller one for the grown-up) by relaying a
// prompt to Claude through the parent's Apps Script (never straight to
// Claude, never with audio or a transcript - see
// src/content/readingCoachPrompt.ts), and falls back to built-in phrases
// (src/content/readingPhrases.ts) whenever that isn't possible or the
// answer doesn't pass the tone checks below. The rules text is always
// written first, synchronously, so the result screen never waits on a
// network call.
//
// PUBLIC CONTRACT (screens import exactly these; keep the signatures):
//   useCoachStage(takeId)                 -> where a take's feedback is in the pipeline
//   requestReadingFeedback(takeId, opts)   -> (re)write feedback for an already-scored take
//   coachStatus()                          -> Settings' "Test ear + coach" button

import { useSyncExternalStore } from 'react'
import { normalizeWord, tokenizeWords } from '../content/textSplit'
import type { ReadingPassage } from '../content/passages'
import { passageById } from '../content/passages'
import {
  buildReadingFeedbackUser,
  READING_COACH_SYSTEM,
  READING_FEEDBACK_SCHEMA,
  type PreviousRead,
  type ReadingFeedbackInput,
  type TrickyCandidate,
} from '../content/readingCoachPrompt'
import { rulePhrases, type RulePhraseContext } from '../content/readingPhrases'
import { isDriveConfigured, type DriveConfig } from './driveUpload'
import { getDoc, type ProgressDoc, type ReadingTake, type TakeScore } from './progress'
import { setTakeAi } from './reading'

export type CoachStage = 'idle' | 'writing' | 'done' | 'failed'

const stages = new Map<string, CoachStage>()
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** For the implementation: publish a take's pipeline stage to any mounted CoachCard. */
export function setCoachStage(takeId: string, stage: CoachStage): void {
  stages.set(takeId, stage)
  for (const l of listeners) l()
}

export function getCoachStage(takeId: string): CoachStage {
  return stages.get(takeId) ?? 'idle'
}

/** React hook: 'writing' while waiting for the coach text, then 'done' / 'failed'. */
export function useCoachStage(takeId: string): CoachStage {
  return useSyncExternalStore(
    subscribe,
    () => getCoachStage(takeId),
    () => getCoachStage(takeId),
  )
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface CoachDeps {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms) as unknown as { unref?: () => void }
    // Node test runners shouldn't be kept alive by a pending 5-minute retry timer.
    if (typeof timer.unref === 'function') timer.unref()
  })
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const AGE = 6

function firstName(kidName: string): string {
  const trimmed = kidName.trim()
  if (trimmed === '') return 'Reader'
  return trimmed.split(/\s+/)[0]
}

function round(n: number): number {
  return Math.round(n)
}

// ---------------------------------------------------------------------------
// Text tidying / validation
// ---------------------------------------------------------------------------

export const MAX_PRAISE_CHARS = 240
export const MAX_TRY_NEXT_CHARS = 160
export const MAX_PARENT_NOTE_CHARS = 1400

/** Tidies model text before validation: long dashes become a plain hyphen, curly quotes become straight. */
export function tidyCoachText(text: string): string {
  return text
    .replace(/\s*(?:\\?u201[34]|[–—])\s*/g, ' - ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

const BANNED_WORDS = ['wrong', 'bad', 'mistake', 'error', 'fail', 'failed', 'lazy', 'terrible', 'slow', 'stupid']

/** Whole-word banned-content check (never a label on her, never "I heard"/"I listened"). */
export function containsBannedContent(text: string): boolean {
  const lower = text.toLowerCase()
  if (BANNED_WORDS.some((w) => new RegExp(`\\b${w}(s|es)?\\b`).test(lower))) return true
  if (/i heard|i listened/i.test(text)) return true
  return false
}

/** Extra checks that only apply to text the kid hears: no percentages, no wpm/pace units, no number over ten. */
export function kidTextViolates(text: string): boolean {
  if (containsBannedContent(text)) return true
  if (text.includes('%')) return true
  if (/\bwpm\b|per minute/i.test(text)) return true
  const numbers = text.match(/\d+/g)
  if (numbers && numbers.some((n) => parseInt(n, 10) > 10)) return true
  return false
}

export interface ValidatedFeedback {
  praise: string
  tryNext: string
  trickyWords: string[]
  parent: { note: string }
}

/** Validates and tidies Claude's raw JSON reply against READING_FEEDBACK_SCHEMA's shape and the tone rules. */
export function validateReadingFeedback(raw: unknown, passageWords: string[]): ValidatedFeedback | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kid = r.kid as Record<string, unknown> | undefined
  const parent = r.parent as Record<string, unknown> | undefined
  if (!kid || typeof kid.praise !== 'string' || typeof kid.tryNext !== 'string' || !Array.isArray(kid.trickyWords)) return null
  if (!parent || typeof parent.note !== 'string') return null

  const praise = tidyCoachText(kid.praise)
  const tryNext = tidyCoachText(kid.tryNext)
  const note = tidyCoachText(parent.note)

  if (praise.length > MAX_PRAISE_CHARS || tryNext.length > MAX_TRY_NEXT_CHARS || note.length > MAX_PARENT_NOTE_CHARS) return null
  if (kidTextViolates(praise) || kidTextViolates(tryNext)) return null
  if (containsBannedContent(note)) return null

  const normalizedPassageWords = new Set(passageWords.map(normalizeWord))
  const seen = new Set<string>()
  const trickyWords: string[] = []
  for (const raw of kid.trickyWords) {
    if (typeof raw !== 'string') continue
    const norm = normalizeWord(raw)
    if (!norm || !normalizedPassageWords.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    trickyWords.push(raw.trim())
    if (trickyWords.length >= 3) break
  }

  return { praise, tryNext, trickyWords, parent: { note } }
}

// ---------------------------------------------------------------------------
// Building the request
// ---------------------------------------------------------------------------

/** Every take of `passageId` that has been scored, oldest first. */
function scoredTakesForPassage(doc: ProgressDoc, passageId: string): ReadingTake[] {
  return doc.reading.takes.filter((t) => t.passageId === passageId && t.score).sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * Rebuilds the exact JSON payload sent to Claude for one take. Pure: takes
 * the take and the whole doc, never reads global state itself, so a
 * background retry can send an identical request. Returns null when the
 * take isn't ready (no score/ear yet) or its passage can no longer be found.
 */
export function buildFeedbackInput(take: ReadingTake, doc: ProgressDoc): ReadingFeedbackInput | null {
  if (!take.score || !take.ear) return null
  const settings = doc.settings
  const passage = passageById(take.passageId, settings.customPassages)
  if (!passage) return null

  const score = take.score
  const ear = take.ear
  const passageWords = tokenizeWords(passage.text).map((t) => t.display)

  const trickyCandidates: TrickyCandidate[] = ear.words
    .filter((w) => w.s !== 'read' && w.i < score.attempted)
    .sort((a, b) => a.i - b.i)
    .slice(0, 8)
    .map((w) => ({ word: w.w, status: w.s as 'stumbled' | 'different' | 'skipped', heard: w.heard }))

  const scoredSamePassage = scoredTakesForPassage(doc, take.passageId)
  const idx = scoredSamePassage.findIndex((t) => t.id === take.id)
  const takeNumberForThisPassage = idx >= 0 ? idx + 1 : scoredSamePassage.length + 1

  const earlier = scoredSamePassage.filter((t) => t.id !== take.id && t.startedAt < take.startedAt)
  const previousReads: PreviousRead[] = earlier.slice(-5).map((t) => {
    const s = t.score as TakeScore
    return { day: t.day, accuracyPct: round(s.accuracy * 100), wcpm: s.wcpm, stars: s.stars, outcome: s.outcome }
  })

  const readsTodaySoFar = doc.reading.takes.filter((t) => t.day === take.day && t.score && t.score.outcome !== 'noReading').length

  const best = doc.reading.passageBests[take.passageId]

  return {
    kidFirstName: firstName(settings.kidName),
    age: AGE,
    passageTitle: passage.title,
    level: passage.level,
    focus: passage.focus,
    passageWords,
    thisTake: {
      outcome: score.outcome,
      attempted: score.attempted,
      read: score.read,
      stumbled: score.stumbled,
      different: score.different,
      skipped: score.skipped,
      accuracyPct: round(score.accuracy * 100),
      wcpm: score.wcpm,
      readSeconds: ear.readSeconds,
      coveragePct: round(score.coverage * 100),
      stars: score.stars,
      trickyCandidates,
      listenedFirst: Boolean(take.listenedFirst),
      takeNumberForThisPassage,
    },
    previousReads,
    passageBest: best ? { wcpm: best.wcpm, accuracyPct: round(best.accuracy * 100) } : undefined,
    readsTodaySoFar,
    streakDays: doc.reading.streak.current,
  }
}

/** Rebuilds the rules-fallback context (same take/doc, same "no transcript, no audio" discipline). */
function buildRuleContext(take: ReadingTake, doc: ProgressDoc, passage: ReadingPassage, kidFirstName: string): RulePhraseContext {
  const scoredSamePassage = scoredTakesForPassage(doc, take.passageId)
  const earlier = scoredSamePassage.filter((t) => t.id !== take.id && t.startedAt < take.startedAt)
  const previous = earlier.length > 0 ? (earlier[earlier.length - 1].score as TakeScore) : undefined

  const scoredAtLevel = doc.reading.takes
    .filter((t) => {
      if (!t.score) return false
      const p = passageById(t.passageId, doc.settings.customPassages)
      return p?.level === passage.level
    })
    .sort((a, b) => a.startedAt - b.startedAt)
  const wordsAtLevelRecentAccuracy = scoredAtLevel.slice(-5).map((t) => (t.score as TakeScore).accuracy)

  return {
    takeId: take.id,
    kidFirstName,
    passageTitle: passage.title,
    score: take.score as TakeScore,
    previous,
    passageBestBefore: doc.reading.passageBests[take.passageId],
    level: passage.level,
    wordsAtLevelRecentAccuracy,
  }
}

// ---------------------------------------------------------------------------
// Talking to the parent's Apps Script
// ---------------------------------------------------------------------------

const COACH_TIMEOUT_MS = 25_000
const RETRY_DELAY_MS = 5 * 60_000

interface CoachOkResponse {
  ok: true
  result: unknown
  model?: string
}
interface CoachFailResponse {
  ok: false
  reason?: string
  detail?: string
}
type CoachApiResponse = CoachOkResponse | CoachFailResponse

async function callCoachRelay(cfg: DriveConfig, input: ReadingFeedbackInput, deps: CoachDeps): Promise<CoachApiResponse> {
  const doFetch = deps.fetch ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COACH_TIMEOUT_MS)
  try {
    const res = await doFetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: controller.signal,
      body: JSON.stringify({
        secret: cfg.secret,
        action: 'coach',
        system: READING_COACH_SYSTEM,
        user: buildReadingFeedbackUser(input),
        schema: READING_FEEDBACK_SCHEMA,
      }),
    })
    let parsed: CoachApiResponse | null = null
    try {
      parsed = (await res.json()) as CoachApiResponse
    } catch {
      parsed = null
    }
    if (!parsed) return { ok: false, reason: `http-${res.status}` }
    return parsed
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return { ok: false, reason: isAbort ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** Reasons worth a single background retry - anything else is a durable failure this run. */
function isTransientReason(reason: string | undefined): boolean {
  if (!reason) return false
  if (reason === 'cap' || reason === 'network' || reason === 'timeout') return true
  return /^http-5\d\d$/.test(reason)
}

const pendingRetries = new Set<string>()

function scheduleCoachRetry(takeId: string, cfg: DriveConfig, input: ReadingFeedbackInput, deps: CoachDeps): void {
  if (pendingRetries.has(takeId)) return
  pendingRetries.add(takeId)
  const sleep = deps.sleep ?? defaultSleep
  void sleep(RETRY_DELAY_MS).then(() => {
    pendingRetries.delete(takeId)
    return retryCoachOnce(takeId, cfg, input, deps)
  })
}

/** The single background retry scheduled after a transient failure - overwrites the rules text if Claude succeeds this time. Never throws. */
async function retryCoachOnce(takeId: string, cfg: DriveConfig, input: ReadingFeedbackInput, deps: CoachDeps): Promise<void> {
  try {
    const take = getDoc().reading.takes.find((t) => t.id === takeId)
    if (!take || take.ai?.source === 'claude') return

    const response = await callCoachRelay(cfg, input, deps)
    if (!response.ok) return
    const validated = validateReadingFeedback(response.result, input.passageWords)
    if (!validated) return

    const trickyWords = validated.trickyWords.length > 0 ? validated.trickyWords : take.score?.trickyWords ?? []
    const now = deps.now ?? Date.now
    setTakeAi(takeId, {
      kid: { praise: validated.praise, tryNext: validated.tryNext, trickyWords },
      parent: validated.parent,
      source: 'claude',
      model: response.model,
      at: now(),
    })
  } catch {
    // Best-effort only - the rules text already shown stands.
  }
}

// ---------------------------------------------------------------------------
// requestReadingFeedback
// ---------------------------------------------------------------------------

/**
 * Writes (or with `force`, rewrites) the feedback for an already-scored
 * take. Always writes the deterministic rules text first and immediately,
 * so the result screen never waits on a network call; only then, if the AI
 * coach is enabled and Drive is configured, tries Claude and upgrades the
 * take's `ai` in place when a valid answer comes back. Never throws.
 */
export async function requestReadingFeedback(takeId: string, opts?: { force?: boolean }, deps: CoachDeps = {}): Promise<void> {
  try {
    const doc = getDoc()
    const take = doc.reading.takes.find((t) => t.id === takeId)
    if (!take || !take.score || !take.ear) return
    if (take.ai && !opts?.force) return

    const settings = doc.settings
    const passage = passageById(take.passageId, settings.customPassages)
    if (!passage) return

    const kidFirstName = firstName(settings.kidName)
    const now = deps.now ?? Date.now

    const ruleCtx = buildRuleContext(take, doc, passage, kidFirstName)
    const rulesResult = rulePhrases(ruleCtx)
    setTakeAi(takeId, { kid: rulesResult.kid, parent: rulesResult.parent, source: 'rules', model: undefined, at: now() })

    const useClaude = settings.aiCoach?.enabled !== false && isDriveConfigured(settings)
    if (!useClaude) {
      setCoachStage(takeId, 'done')
      return
    }

    setCoachStage(takeId, 'writing')
    const input = buildFeedbackInput(take, doc)
    if (!input) {
      setCoachStage(takeId, 'done')
      return
    }

    const cfg = settings.driveUpload as DriveConfig
    const response = await callCoachRelay(cfg, input, deps)

    if (response.ok) {
      const validated = validateReadingFeedback(response.result, input.passageWords)
      if (validated) {
        const trickyWords = validated.trickyWords.length > 0 ? validated.trickyWords : take.score.trickyWords
        setTakeAi(takeId, {
          kid: { praise: validated.praise, tryNext: validated.tryNext, trickyWords },
          parent: validated.parent,
          source: 'claude',
          model: response.model,
          at: now(),
        })
      }
      setCoachStage(takeId, 'done')
    } else {
      setCoachStage(takeId, 'done')
      if (isTransientReason(response.reason)) scheduleCoachRetry(takeId, cfg, input, deps)
    }
  } catch {
    setCoachStage(takeId, 'failed')
  }
}

// ---------------------------------------------------------------------------
// coachStatus - for Settings' "Test ear + coach" button
// ---------------------------------------------------------------------------

export interface CoachStatusResult {
  ok: boolean
  reason?: string
  hasGeminiKey?: boolean
  geminiModel?: string
  geminiOk?: boolean
  geminiError?: string
  hasClaudeKey?: boolean
  claudeOk?: boolean
  claudeError?: string
  readUsedToday?: number
  readCap?: number
  coachUsedToday?: number
  coachCap?: number
  lookupUsedToday?: number
  lookupCap?: number
}

interface ReadStatusResponse {
  ok?: boolean
  reason?: string
  error?: string
  hasGeminiKey?: boolean
  geminiModel?: string
  geminiOk?: boolean
  geminiError?: string
  hasClaudeKey?: boolean
  claudeOk?: boolean
  claudeError?: string
  readUsedToday?: number
  readCap?: number
  coachUsedToday?: number
  coachCap?: number
  lookupUsedToday?: number
  lookupCap?: number
}

export async function coachStatus(deps: CoachDeps = {}): Promise<CoachStatusResult> {
  const settings = getDoc().settings
  if (!isDriveConfigured(settings)) return { ok: false, reason: 'not-configured' }

  const doFetch = deps.fetch ?? fetch
  try {
    const res = await doFetch(settings.driveUpload.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ secret: settings.driveUpload.secret, action: 'read-status' }),
    })
    let parsed: ReadStatusResponse | null = null
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    if (!parsed) return { ok: false, reason: `http-${res.status}` }
    if (!parsed.ok) return { ok: false, reason: parsed.reason ?? parsed.error ?? 'error' }

    return {
      ok: true,
      hasGeminiKey: Boolean(parsed.hasGeminiKey),
      geminiModel: parsed.geminiModel,
      geminiOk: Boolean(parsed.geminiOk),
      geminiError: parsed.geminiError,
      hasClaudeKey: Boolean(parsed.hasClaudeKey),
      claudeOk: Boolean(parsed.claudeOk),
      claudeError: parsed.claudeError,
      readUsedToday: parsed.readUsedToday ?? 0,
      readCap: parsed.readCap ?? 0,
      coachUsedToday: parsed.coachUsedToday ?? 0,
      coachCap: parsed.coachCap ?? 0,
      lookupUsedToday: parsed.lookupUsedToday ?? 0,
      lookupCap: parsed.lookupCap ?? 0,
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'network' }
  }
}
