// Parent-triggered passage lookups: OCR a photographed book page, or search
// for a passage by book title, both proxied through the parent's Apps
// Script (never straight to the vision/search API - see
// scripts/read-aloud.gs's doOcr/doFindBook). Pure request/response shaping
// plus injected deps, no React - src/store/customPassages.ts is where a
// confirmed result gets saved.

import { LEVELS, LEVEL_WORDS, SIGHT_WORDS, type PassageLevel } from '../content/passages'
import { isDriveConfigured, type DriveConfig } from './driveUpload'
import { getDoc } from './progress'

export type LookupReason =
  | 'not-configured'
  | 'network'
  | 'timeout'
  | 'bad-json'
  | 'cap'
  | 'no-key'
  | 'blocked'
  | `http-${number}`
  | string

export interface OcrResult {
  title: string
  text: string
  warnings: string[]
}

export interface FindBookResult {
  kind: 'excerpt' | 'original' | 'none'
  title: string
  text: string
  note: string
}

export type LookupOutcome<T> = { ok: true; result: T; usedToday?: number } | { ok: false; reason: LookupReason; detail?: string }

export interface LookupDeps {
  fetch?: typeof fetch
}

/** Pre-fills the Settings "find a book by title" form and is the Phase 3 test fixture's title (see the plan's section 5b). */
export const DEFAULT_FIND_TITLE = 'The Princess in Black and the Science Fair Scare'

const OCR_TIMEOUT_MS = 45_000
const FIND_BOOK_TIMEOUT_MS = 60_000
const MAX_EXCERPT_WORDS = 80
const FORCED_ORIGINAL_NOTE = "Made up from the story - not the book's words"

/** Collapses runs of spaces/tabs and trims - never touches newlines. */
function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

interface RelayOkResponse {
  ok: true
  result: unknown
  usedToday?: number
}
interface RelayFailResponse {
  ok: false
  reason?: string
  detail?: string
}
type RelayResponse = RelayOkResponse | RelayFailResponse

/** Shared POST + timeout plumbing for both actions - no retry, `redirect: 'follow'`, plain-text content type (matches driveUpload.ts/readingCoach.ts). */
async function postToScript(cfg: DriveConfig, body: Record<string, unknown>, timeoutMs: number, doFetch: typeof fetch): Promise<RelayResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(cfg.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: controller.signal,
      body: JSON.stringify(body),
    })
    let parsed: RelayResponse | null = null
    try {
      parsed = (await res.json()) as RelayResponse
    } catch {
      parsed = null
    }
    if (!parsed) return { ok: false, reason: res.ok ? 'bad-json' : `http-${res.status}` }
    return parsed
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return { ok: false, reason: isAbort ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

function asReason(reason: string | undefined): LookupReason {
  return (reason ?? 'bad-json') as LookupReason
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

function validateOcrResult(raw: unknown): OcrResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.title !== 'string' || typeof r.text !== 'string') return null
  const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : []
  return { title: tidy(r.title), text: tidy(r.text), warnings }
}

/** Sends a photographed book page to the parent's script for transcription. Never throws. */
export async function ocrPage(imageBase64: string, mediaType: 'image/jpeg' | 'image/png', deps: LookupDeps = {}): Promise<LookupOutcome<OcrResult>> {
  const settings = getDoc().settings
  if (!isDriveConfigured(settings)) return { ok: false, reason: 'not-configured' }

  const doFetch = deps.fetch ?? fetch
  const response = await postToScript(
    settings.driveUpload,
    { secret: settings.driveUpload.secret, action: 'ocr', imageBase64, mediaType },
    OCR_TIMEOUT_MS,
    doFetch,
  )
  if (!response.ok) return { ok: false, reason: asReason(response.reason), detail: response.detail }

  const result = validateOcrResult(response.result)
  if (!result) return { ok: false, reason: 'bad-json' }
  return { ok: true, result, usedToday: response.usedToday }
}

// ---------------------------------------------------------------------------
// Find a book by title
// ---------------------------------------------------------------------------

/** Truncates to at most 80 words, preferring to end at the last sentence-ending punctuation within that budget. */
export function truncateExcerptTo80Words(text: string): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length <= MAX_EXCERPT_WORDS) return text.trim()
  const truncated = words.slice(0, MAX_EXCERPT_WORDS).join(' ')
  const lastSentenceEnd = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'))
  if (lastSentenceEnd > 0) return truncated.slice(0, lastSentenceEnd + 1)
  return `${truncated}...`
}

/** kind === 'original' always gets the fixed label, client-side too; an excerpt over 80 words gets cut down. */
function applyFindBookInvariants(result: FindBookResult): FindBookResult {
  if (result.kind === 'original') return { ...result, note: FORCED_ORIGINAL_NOTE }
  if (result.kind === 'excerpt') return { ...result, text: truncateExcerptTo80Words(result.text) }
  return result
}

function validateFindBookResult(raw: unknown): FindBookResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind !== 'excerpt' && r.kind !== 'original' && r.kind !== 'none') return null
  if (typeof r.title !== 'string') return null
  const text = typeof r.text === 'string' ? r.text : ''
  const note = typeof r.note === 'string' ? r.note : ''
  return applyFindBookInvariants({ kind: r.kind, title: tidy(r.title), text: tidy(text), note: tidy(note) })
}

/** Asks the parent's script to find a passage from a book by title, public-domain excerpt preferred. Never throws. */
export async function findBook(title: string, level: PassageLevel, deps: LookupDeps = {}): Promise<LookupOutcome<FindBookResult>> {
  const settings = getDoc().settings
  if (!isDriveConfigured(settings)) return { ok: false, reason: 'not-configured' }

  const doFetch = deps.fetch ?? fetch
  const levelHint = levelHintText(level)
  const response = await postToScript(
    settings.driveUpload,
    { secret: settings.driveUpload.secret, action: 'find-book', title, level, levelHint },
    FIND_BOOK_TIMEOUT_MS,
    doFetch,
  )
  if (!response.ok) return { ok: false, reason: asReason(response.reason), detail: response.detail }

  const result = validateFindBookResult(response.result)
  if (!result) return { ok: false, reason: 'bad-json' }
  return { ok: true, result, usedToday: response.usedToday }
}

// ---------------------------------------------------------------------------
// levelHintText
// ---------------------------------------------------------------------------

/** A human sentence describing what phonics/vocabulary a level allows, sent to the script as `levelHint`. */
export function levelHintText(level: PassageLevel): string {
  const info = LEVELS.find((l) => l.level === level)
  const focus = info?.focus ?? 'early phonics'
  const samples = (LEVEL_WORDS[level] ?? []).slice(0, 6)
  const sightSample = SIGHT_WORDS.slice(0, 6).join(', ')
  const wordsPart = samples.length > 0 ? ` Example words: ${samples.join(', ')}.` : ''
  return `Reading level ${level} of 8, focused on ${focus}.${wordsPart} Sight words allowed at every level: ${sightSample}.`
}
