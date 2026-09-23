import { useSyncExternalStore } from 'react'
import { APP_BUILD } from '../buildInfo'
import type { ReadingPassage } from '../content/passages'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Prize {
  id: string
  name: string
  emoji: string
  weight: number
  /** When 'cash', this prize pays out a random amount instead of a fixed reward. */
  kind?: 'cash'
  /** Cash prize range, in whole cents. Only meaningful when kind === 'cash'. */
  minCents?: number
  maxCents?: number
}

export interface Settings {
  kidName: string
  parentName: string
  pin: string
  /** 1 (easiest) through 8 (hardest) - see src/content/passages.ts's levels. */
  readingLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  /** How many not-`noReading` takes count toward the daily goal. */
  readsPerDay: number
  /** Auto-stops a take after this many seconds. */
  maxRecordSeconds: number
  /** Whether the "Listen first" step is offered before recording. */
  listenFirst: boolean
  /** Parent-typed / photographed / found-by-title passages, in addition to the built-in library. */
  customPassages: ReadingPassage[]
  /** How many days of local audio to keep before pruning. */
  recordingKeepDays: number
  /** Parent-entered once, synced via the private gist. Undefined = uploads off. */
  driveUpload?: { scriptUrl: string; secret: string; folderName: string }
  /** AI coach feedback. Undefined = on (it silently uses built-in phrases until the Apps Script has an API key). */
  aiCoach?: { enabled: boolean }
  /** The Gemini "ear" that scores a take. Undefined = on. */
  ear?: { enabled: boolean }
  prizePools: {
    gold: Prize[]
    silver: Prize[]
    bronze: Prize[]
  }
  /** Probability (0-1) that opening a box of this tier also awards a ticket. */
  ticketChance: {
    gold: number
    silver: number
    bronze: number
  }
  updatedAt: number
}

export interface Streak {
  current: number
  best: number
  lastDay: string // YYYY-MM-DD
  /** Local YYYY-MM-DD the forgiving streak's weekly freeze was last spent (see sessions.ts's bumpStreakForgiving). */
  freezeUsedOn?: string
}

export interface Profile {
  xp: number
  tokens: { gold: number; silver: number; bronze: number }
  updatedAt: number
}

export interface Sticker {
  id: string
  kind: 'emoji' | 'image'
  value: string
  rarity: 'common' | 'rare'
  wonAt: number
}

export interface CustomSticker {
  id: string
  name: string
  dataUrl: string
}

export interface Ticket {
  id: string
  prizeId: string
  name: string
  emoji: string
  tier: 'gold' | 'silver' | 'bronze'
  wonAt: number
  redeemedAt?: number
  /** Set when this ticket was won from a cash prize; the actual rolled amount, in cents. */
  amountCents?: number
}

export interface BoxHistoryEntry {
  tier: 'gold' | 'silver' | 'bronze'
  openedAt: number
  result: string
  /** Collection item the box held (content/collection.ts id). */
  itemId?: string
}

export interface EarnedBadge {
  id: string
  earnedAt: number
}

export interface Rewards {
  stickers: Sticker[]
  customStickers: CustomSticker[]
  tickets: Ticket[]
  boxHistory: BoxHistoryEntry[]
  badges?: EarnedBadge[]
  updatedAt: number
}

/** A message from the grown-up, shown on Home until she taps "Got it". */
export interface Note {
  id: string
  /** Local YYYY-MM-DD it was written. */
  day: string
  about: 'reading' | 'general'
  text?: string
  /** A short voice note recorded as a reading take flagged for the note (kept for parity with the Notes UI; unused until a note recorder exists). */
  audioTakeId?: string
  createdAt: number
  seenAt?: number
}

export interface NotesSection {
  items: Note[]
  updatedAt: number
}

// --- Photo collection (the reward system from KidEdu round 6, minus beads/bracelets) --

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

/** One collection card she owns (id from src/content/collection.ts). */
export interface OwnedItem {
  id: string
  /** How many times it dropped. */
  count: number
  firstAt: number
}

export interface CollectionSection {
  items: OwnedItem[]
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Reading (src/store/reading.ts owns the actions on this section)
// ---------------------------------------------------------------------------

export type WordStatus = 'read' | 'skipped' | 'stumbled' | 'different'

export interface EarResultWord {
  i: number
  w: string
  s: WordStatus
  heard?: string
}

/** What the Gemini "ear" reported about one take. Never a judgement of right/wrong - a measurement through a microphone. */
export interface EarResult {
  words: EarResultWord[]
  extraWords: string[]
  readSeconds: number
  /** 0-1. */
  confidence: number
  transcript: string
  model?: string
  at: number
  /** Set when the transcript cross-check couldn't confirm the per-word alignment (see readingScore.ts's validateEar). */
  unsure?: boolean
}

export type TakeOutcome = 'full' | 'partial' | 'noReading' | 'unsure'

export interface TakeScore {
  outcome: TakeOutcome
  stars: 0 | 1 | 2 | 3
  attempted: number
  read: number
  stumbled: number
  different: number
  skipped: number
  /** (read+stumbled)/attempted. */
  accuracy: number
  /** read/attempted - a stricter accuracy that doesn't credit a sounded-out word. */
  cleanAccuracy: number
  /** attempted / total expected words, 0-1. */
  coverage: number
  wcpm: number
  /** wcpm * accuracy, only set for a full, accurate read - see readingScore.ts. */
  smooth?: number
  /** Up to 3 words to practise, worst first. */
  trickyWords: string[]
  newPassageBest: boolean
}

export interface ReadingTake {
  id: string
  day: string // local YYYY-MM-DD
  passageId: string
  startedAt: number
  durationSec: number
  listenedFirst?: boolean
  mimeType: string
  sizeBytes: number
  hasAudio: boolean
  audioPrunedAt?: number
  deviceId: string
  /** 160 peak-amplitude buckets 0-100, computed from the audio on save; drawn under the player. */
  waveform?: number[]
  earStatus?: 'pending' | 'done' | 'failed'
  ear?: EarResult
  score?: TakeScore
  ai?: {
    kid?: { praise: string; tryNext: string; trickyWords: string[] }
    parent?: { note: string }
    /** 'claude' = written by the AI from the score; 'rules' = built-in phrases (offline / no key / fallback). */
    source?: 'claude' | 'rules'
    model?: string
    at: number
  }
  upload?: {
    status: 'pending' | 'uploading' | 'done' | 'failed'
    attempts: number
    driveFileId?: string
    driveUrl?: string
    lastError?: string
    updatedAt: number
  }
}

export interface ReadingDay {
  goalReachedAt?: number
  bestAwardedAt?: number
  parentStars?: 1 | 2 | 3
  parentRatedAt?: number
}

export interface PassageBest {
  smooth: number
  wcpm: number
  accuracy: number
  takeId: string
  day: string
}

/** One personal record: the value, when it was set, and where (take / day / passage) so the kid can find it. */
export interface RecordEntry {
  value: number
  day: string
  setAt: number
  takeId?: string
  passageId?: string
}

/**
 * Personal records, derived from the takes (src/store/records.ts is the source
 * of truth) and cached here so a new record can be spotted cheaply and
 * celebrated once. Absent until the first take after the feature shipped.
 */
export interface Records {
  mostReadsInDay?: RecordEntry
  longestStreakDays?: RecordEntry
  smoothestRead?: RecordEntry
  passagesWithThreeStars?: RecordEntry
}

export interface ReadingSection {
  takes: ReadingTake[]
  days: Record<string, ReadingDay>
  streak: Streak
  passageBests: Record<string, PassageBest>
  /** Per-word practice bookkeeping for the tricky-words screen. */
  practice: Record<string, { tries: number; ok: number; lastAt: number }>
  records?: Records
  updatedAt: number
}

export interface ProgressDoc {
  schemaVersion: 1
  settings: Settings
  profile: Profile
  rewards: Rewards
  reading: ReadingSection
  notes: NotesSection
  collection: CollectionSection
}

export type SectionKey = 'settings' | 'profile' | 'rewards' | 'reading' | 'notes' | 'collection'

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function prize(id: string, name: string, emoji: string, weight = 1): Prize {
  return { id, name, emoji, weight }
}

/** The gold-tier cash surprise: a random amount between $0.25 and $1.00. */
function goldCashPrize(weight = 1): Prize {
  return { id: 'gold-cash', name: 'Cash surprise', emoji: '💵', weight, kind: 'cash', minCents: 25, maxCents: 100 }
}

/** The silver-tier cash surprise: a random amount between $0.05 and $1.00. */
function silverCashPrize(weight = 1): Prize {
  return { id: 'silver-cash', name: 'Cash surprise', emoji: '💵', weight, kind: 'cash', minCents: 5, maxCents: 100 }
}

function emptyProfile(updatedAt: number): Profile {
  return { xp: 0, tokens: { gold: 0, silver: 0, bronze: 0 }, updatedAt }
}

export function emptyReading(updatedAt: number): ReadingSection {
  return {
    takes: [],
    days: {},
    streak: { current: 0, best: 0, lastDay: '' },
    passageBests: {},
    practice: {},
    updatedAt,
  }
}

export function emptyNotes(updatedAt: number): NotesSection {
  return { items: [], updatedAt }
}

export function emptyCollection(updatedAt: number): CollectionSection {
  return { items: [], updatedAt }
}

function normalizeCollection(parsed: Partial<CollectionSection> | undefined): CollectionSection {
  if (!parsed) return emptyCollection(0)
  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  }
}

function normalizeNotes(parsed: Partial<NotesSection> | undefined): NotesSection {
  if (!parsed) return emptyNotes(0)
  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  }
}

function normalizeReading(parsed: Partial<ReadingSection> | undefined): ReadingSection {
  const fallback = emptyReading(0)
  return {
    ...fallback,
    ...parsed,
    takes: parsed?.takes ?? fallback.takes,
    days: { ...fallback.days, ...parsed?.days },
    streak: { ...fallback.streak, ...parsed?.streak },
    passageBests: { ...fallback.passageBests, ...parsed?.passageBests },
    practice: { ...fallback.practice, ...parsed?.practice },
  }
}

function normalizeProfile(fallback: Profile, parsed: Partial<Profile> | undefined): Profile {
  return {
    ...fallback,
    ...parsed,
    tokens: { ...fallback.tokens, ...parsed?.tokens },
  }
}

/** True for a prize that predates cash-surprise ranges: the old fixed-dollar prizes. */
function isLegacyFixedCashPrize(p: Prize): boolean {
  return p.id === 'gold-cash-5' || p.id === 'silver-cash-1' || /^\$\d+$/.test(p.name)
}

/**
 * Migrates a saved prize pool so any old fixed-dollar prize ($5, $1, or any
 * prize carrying one of their legacy ids/names) becomes the tier's cash
 * surprise, preserving the pool's own weight for that slot.
 */
function migratePrizePool(pool: Prize[], tier: 'gold' | 'silver' | 'bronze'): Prize[] {
  return pool.map((p) => {
    if (p.kind === 'cash' || !isLegacyFixedCashPrize(p)) return p
    return tier === 'gold' ? goldCashPrize(p.weight) : silverCashPrize(p.weight)
  })
}

export function defaultDoc(): ProgressDoc {
  const now = Date.now()
  return {
    schemaVersion: 1,
    settings: {
      kidName: 'Reader',
      parentName: '',
      pin: '1234',
      readingLevel: 1,
      readsPerDay: 3,
      maxRecordSeconds: 60,
      listenFirst: true,
      customPassages: [],
      recordingKeepDays: 14,
      prizePools: {
        gold: [
          goldCashPrize(),
          prize('gold-dinner', 'Choose dinner', '🍕'),
          prize('gold-movie-night', 'Movie night', '🎬'),
        ],
        silver: [
          silverCashPrize(),
          prize('silver-snack', 'Snack', '🍪'),
          prize('silver-story', 'Extra story', '📖'),
        ],
        bronze: [
          prize('bronze-high-five', 'High five', '🙌'),
          prize('bronze-sticker', 'Sticker', '⭐'),
          prize('bronze-dance-party', 'Dance party', '💃'),
        ],
      },
      ticketChance: { gold: 1, silver: 0.6, bronze: 0.3 },
      updatedAt: now,
    },
    profile: emptyProfile(now),
    rewards: {
      stickers: [],
      customStickers: [],
      tickets: [],
      boxHistory: [],
      badges: [],
      updatedAt: now,
    },
    reading: emptyReading(now),
    notes: emptyNotes(now),
    collection: emptyCollection(now),
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'readaloud.progress'

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

/**
 * Backfills any field added to the schema after a doc was first persisted,
 * without bumping schemaVersion (schemaVersion covers *shape-breaking*
 * changes; new optional-in-spirit fields with sane defaults are handled
 * here instead so old saves keep working).
 */
export function normalizeDoc(parsed: Partial<ProgressDoc>): ProgressDoc {
  const fallback = defaultDoc()
  const mergedPrizePools = { ...fallback.settings.prizePools, ...parsed.settings?.prizePools }
  return {
    ...fallback,
    // Spreading `parsed` here (before the known-section overrides below)
    // means any top-level key this build doesn't recognize - a section a
    // *newer* build added to ProgressDoc that this cached build has never
    // heard of - passes straight through untouched, instead of being
    // silently dropped. See mergeDocs()'s mergeUnknownSections() for the
    // sync-side half of this guarantee.
    ...parsed,
    settings: {
      ...fallback.settings,
      ...parsed.settings,
      customPassages: Array.isArray(parsed.settings?.customPassages) ? parsed.settings.customPassages : fallback.settings.customPassages,
      recordingKeepDays: parsed.settings?.recordingKeepDays ?? fallback.settings.recordingKeepDays,
      prizePools: {
        gold: migratePrizePool(mergedPrizePools.gold, 'gold'),
        silver: migratePrizePool(mergedPrizePools.silver, 'silver'),
        bronze: migratePrizePool(mergedPrizePools.bronze, 'bronze'),
      },
      ticketChance: { ...fallback.settings.ticketChance, ...parsed.settings?.ticketChance },
    },
    profile: normalizeProfile(fallback.profile, parsed.profile),
    rewards: {
      ...fallback.rewards,
      ...parsed.rewards,
      badges: Array.isArray(parsed.rewards?.badges) ? parsed.rewards.badges : [],
    },
    reading: normalizeReading(parsed.reading),
    notes: normalizeNotes(parsed.notes),
    collection: normalizeCollection(parsed.collection),
  }
}

/**
 * Like defaultDoc(), but every section is stamped `updatedAt: 0` instead of
 * "now". Used whenever this device has no real saved progress to speak of
 * (nothing in storage, or what was there didn't parse). A blank doc has no
 * actual edit for mergeDocs to protect, so it must never outrank genuine
 * progress pulled down from a synced gist.
 */
export function neverEditedDoc(): ProgressDoc {
  const fresh = defaultDoc()
  return {
    ...fresh,
    settings: { ...fresh.settings, updatedAt: 0 },
    profile: { ...fresh.profile, updatedAt: 0 },
    rewards: { ...fresh.rewards, updatedAt: 0 },
    reading: emptyReading(0),
    notes: emptyNotes(0),
    collection: emptyCollection(0),
  }
}

// ---------------------------------------------------------------------------
// Automatic migration backups
// ---------------------------------------------------------------------------

const BACKUPS_KEY = 'readaloud.progress.backups'
const BUILD_ID_KEY = 'readaloud.buildId'
const MAX_BACKUPS = 3

interface StoredBackup {
  savedAt: number
  buildId: string
  json: string
}

function readBackups(): StoredBackup[] {
  if (!hasLocalStorage()) return []
  try {
    const raw = localStorage.getItem(BACKUPS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredBackup[]) : []
  } catch {
    return []
  }
}

function writeBackups(backups: StoredBackup[]): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups.slice(-MAX_BACKUPS)))
  } catch {
    // Storage full/disabled - the backup just won't be available; not fatal.
  }
}

function pushBackup(json: string, buildId: string): void {
  writeBackups([...readBackups(), { savedAt: Date.now(), buildId, json }])
}

/** Automatic-backup list for Settings -> Backup, newest first. */
export function listBackups(): { savedAt: number; buildId: string; bytes: number }[] {
  return readBackups()
    .map((b) => ({ savedAt: b.savedAt, buildId: b.buildId, bytes: b.json.length }))
    .reverse()
}

/**
 * Restores backup `index` (as returned by listBackups() - 0 is newest)
 * through the normal importJson() path. Stashes the *current* doc as one
 * more backup first, so restoring is itself reversible from the same list.
 */
export function restoreBackup(index: number): void {
  const newestFirst = readBackups().slice().reverse()
  const entry = newestFirst[index]
  if (!entry) throw new Error('No backup at that position')
  pushBackup(exportJson(), APP_BUILD)
  importJson(entry.json)
}

function loadInitialDoc(): ProgressDoc {
  if (!hasLocalStorage()) return neverEditedDoc()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return neverEditedDoc()
    const parsed = JSON.parse(raw) as Partial<ProgressDoc>
    if (!parsed || parsed.schemaVersion !== 1) return neverEditedDoc()
    const normalized = normalizeDoc(parsed)

    const shapeChanged = JSON.stringify(normalized) !== raw
    const buildChanged = localStorage.getItem(BUILD_ID_KEY) !== APP_BUILD
    if (shapeChanged || buildChanged) pushBackup(raw, APP_BUILD)
    try {
      localStorage.setItem(BUILD_ID_KEY, APP_BUILD)
    } catch {
      // Non-fatal - just means the build-change check re-fires next launch too.
    }

    return normalized
  } catch {
    return neverEditedDoc()
  }
}

let doc: ProgressDoc = loadInitialDoc()
const listeners = new Set<() => void>()

/** Re-reads the document from storage. Only used by tests. */
export function reloadFromStorage(): void {
  doc = loadInitialDoc()
  notify()
}

function persist(): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
  } catch {
    // Storage can be full or disabled (private browsing); progress just
    // won't survive a reload in that case, which is an acceptable fallback.
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

export function getDoc(): ProgressDoc {
  return doc
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React hook: re-renders whenever any section of the doc changes. */
export function useProgress(): ProgressDoc {
  return useSyncExternalStore(subscribe, getDoc, getDoc)
}

/**
 * Updates one top-level section of the doc. `fn` receives the section's
 * current value and returns the next value; `updatedAt` is stamped
 * automatically (overwriting anything `fn` sets on it). Callers should check
 * before calling update() so a genuine no-op never bumps a section's
 * `updatedAt`, which would needlessly out-rank another device's edits during
 * a sync merge.
 */
export function update<K extends SectionKey>(
  section: K,
  fn: (current: ProgressDoc[K]) => ProgressDoc[K],
): void {
  const next = { ...fn(doc[section]), updatedAt: Date.now() } as ProgressDoc[K]
  doc = { ...doc, [section]: next }
  persist()
  notify()
}

/**
 * Picks whichever of two sections has the newer `updatedAt`, local wins
 * ties. `remote` may be `undefined` - a doc uploaded by an old build that
 * predates this section - in which case `local` always wins outright.
 */
function newer<T extends { updatedAt: number }>(local: T, remote: T | undefined): T {
  if (!remote) return local
  return remote.updatedAt > local.updatedAt ? remote : local
}

const KNOWN_SECTION_KEYS = new Set(['schemaVersion', 'settings', 'profile', 'rewards', 'reading', 'notes', 'collection'])

function sectionUpdatedAt(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt
  return typeof updatedAt === 'number' ? updatedAt : undefined
}

/**
 * Carries over any top-level key neither this build's `mergeDocs` nor
 * `normalizeDoc` recognizes - a section a *newer* build added to
 * `ProgressDoc` that this cached build has never heard of - so merging two
 * docs on an old build can never silently delete it.
 */
export function mergeUnknownSections(local: ProgressDoc, remote: ProgressDoc): Record<string, unknown> {
  const localRecord = local as unknown as Record<string, unknown>
  const remoteRecord = remote as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(localRecord), ...Object.keys(remoteRecord)])) {
    if (KNOWN_SECTION_KEYS.has(key)) continue
    const hasLocal = Object.prototype.hasOwnProperty.call(localRecord, key)
    const hasRemote = Object.prototype.hasOwnProperty.call(remoteRecord, key)
    if (hasLocal && !hasRemote) {
      out[key] = localRecord[key]
    } else if (hasRemote && !hasLocal) {
      out[key] = remoteRecord[key]
    } else {
      const localUpdatedAt = sectionUpdatedAt(localRecord[key])
      const remoteUpdatedAt = sectionUpdatedAt(remoteRecord[key])
      out[key] =
        localUpdatedAt !== undefined && remoteUpdatedAt !== undefined
          ? remoteUpdatedAt > localUpdatedAt
            ? remoteRecord[key]
            : localRecord[key]
          : remoteRecord[key]
    }
  }
  return out
}

/**
 * Merges two docs section-by-section: whichever side has the newer
 * `updatedAt` for a given section wins outright (sections are not merged
 * field-by-field - each section is a single unit). Any top-level key outside
 * the known sections is preserved too - see mergeUnknownSections().
 */
export function mergeDocs(local: ProgressDoc, remote: ProgressDoc): ProgressDoc {
  return {
    ...mergeUnknownSections(local, remote),
    schemaVersion: 1,
    settings: newer(local.settings, remote.settings),
    profile: newer(local.profile, remote.profile),
    rewards: newer(local.rewards, remote.rewards),
    reading: newer(local.reading ?? emptyReading(0), remote.reading),
    notes: newer(local.notes ?? emptyNotes(0), remote.notes),
    collection: newer(local.collection ?? emptyCollection(0), remote.collection),
  }
}

export function exportJson(): string {
  return JSON.stringify(doc, null, 2)
}

/** Replaces the whole doc from a previously-exported JSON string. */
export function importJson(text: string): void {
  const parsed = JSON.parse(text) as Partial<ProgressDoc>
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) {
    throw new Error('Unrecognized reading progress file')
  }
  doc = normalizeDoc(parsed)
  persist()
  notify()
}

/**
 * Wipes this device. Sections are stamped updatedAt: 0 so a reset can never
 * out-rank real progress on another device during a sync merge; the other
 * device simply re-uploads its data.
 */
export function resetAll(): void {
  doc = neverEditedDoc()
  persist()
  notify()
}
