// Actions on the `reading` section of the ProgressDoc, plus the local
// per-device id used to tell "recorded on this device" (with a playable
// local blob) apart from "recorded on another device" (metadata only).
// Mirrors the shape of KidEdu's src/store/piano.ts: thin wrappers around
// `update()` plus one React hook.

import {
  getDoc,
  useProgress,
  update,
  type EarResult,
  type ReadingSection,
  type ReadingTake,
  type TakeScore,
} from './progress'
import { bumpStreakForgiving, dayOffset, localDay } from './sessions'
import { xpForTier, type Tier } from './rewards'
import { goalReached, readsForDay, tokenForParentStars } from './readingRewards'
import { getRecordingStore } from './recordings'

const DEVICE_ID_KEY = 'readaloud.deviceId'

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
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

let cachedDeviceId: string | null = null

/** A random id identifying this device/browser install, created once and persisted. */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId
  if (hasLocalStorage()) {
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY)
      if (existing) {
        cachedDeviceId = existing
        return existing
      }
      const created = randomId()
      localStorage.setItem(DEVICE_ID_KEY, created)
      cachedDeviceId = created
      return created
    } catch {
      // Storage disabled/full: fall through to an in-memory id below, which
      // just won't survive a reload.
    }
  }
  cachedDeviceId = randomId()
  return cachedDeviceId
}

/** How many days of take *metadata* to keep (the doc, not the audio - see recordingKeepDays for that). */
const TAKE_RETENTION_DAYS = 180

export function saveTake(take: ReadingTake): void {
  update('reading', (reading) => {
    const cutoff = dayOffset(take.day, -(TAKE_RETENTION_DAYS - 1))
    // Drop metadata for takes older than the retention window, but never the
    // take being saved right now even if the clock is somehow off.
    const kept = reading.takes.filter((t) => t.day >= cutoff || t.day === take.day)
    return { ...reading, takes: [...kept, take] }
  })
}

/** Writes the Gemini "ear" result onto a saved take and marks it done. */
export function setTakeEar(takeId: string, ear: EarResult): void {
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => (t.id === takeId ? { ...t, ear, earStatus: 'done' } : t)),
  }))
}

/** Writes the computed score onto a saved take. */
export function setTakeScore(takeId: string, score: TakeScore): void {
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => (t.id === takeId ? { ...t, score } : t)),
  }))
}

/** Merges `ai` onto a take's `ai` field (kid + parent feedback can land separately). */
export function setTakeAi(takeId: string, ai: NonNullable<ReadingTake['ai']>): void {
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => (t.id === takeId ? { ...t, ai: { ...t.ai, ...ai } } : t)),
  }))
}

/** Writes a lazily-computed waveform back onto a saved take (see TakePlayer's one-time compute for old takes). */
export function setTakeWaveform(takeId: string, waveform: number[]): void {
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => (t.id === takeId ? { ...t, waveform } : t)),
  }))
}

/** Marks the given takes' audio as pruned from local storage (called after RecordingStore.pruneOlderThan). */
export function markAudioPruned(takeIds: string[], at: number = Date.now()): void {
  if (takeIds.length === 0) return
  const idSet = new Set(takeIds)
  update('reading', (reading) => ({
    ...reading,
    takes: reading.takes.map((t) => (idSet.has(t.id) ? { ...t, hasAudio: false, audioPrunedAt: at } : t)),
  }))
}

/** Removes local audio older than `keepDays` and marks the matching takes pruned. Safe to call repeatedly. */
export async function pruneRecordings(keepDays: number): Promise<void> {
  const cutoff = Date.now() - keepDays * 86_400_000
  const removedIds = await getRecordingStore().pruneOlderThan(cutoff)
  markAudioPruned(removedIds)
}

function grantToken(tier: Tier): void {
  update('profile', (profile) => ({
    ...profile,
    xp: profile.xp + xpForTier(tier),
    tokens: { ...profile.tokens, [tier]: profile.tokens[tier] + 1 },
  }))
}

/**
 * Awards the daily reading goal exactly once per local day: a bronze token
 * plus its XP, `days[day].goalReachedAt` stamped, and the forgiving streak
 * bumped. Returns true only when it actually awarded just now (so the
 * caller knows whether to celebrate).
 */
export function awardReadIfGoalReached(day: string): boolean {
  // Checked before update() so a no-op never bumps reading.updatedAt, which
  // would needlessly out-rank another device's edits during a sync merge.
  const doc = getDoc()
  if (doc.reading.days[day]?.goalReachedAt) return false
  if (!goalReached(readsForDay(doc.reading.takes, day), doc.settings.readsPerDay)) return false

  update('reading', (reading) => ({
    ...reading,
    days: { ...reading.days, [day]: { ...reading.days[day], goalReachedAt: Date.now() } },
    streak: bumpStreakForgiving(reading.streak, day),
  }))
  grantToken('bronze')
  return true
}

/**
 * Awards a silver token for a new passage best, at most once per local day
 * (the passage-best record itself is still updated every time, even after
 * today's token is spent). Relies on the take's own `score.newPassageBest`
 * (computed by readingScore.ts at scoring time) rather than recomputing it
 * here. Returns true only when a token was actually granted just now.
 */
export function awardPassageBestIfBeaten(takeId: string): boolean {
  const doc = getDoc()
  const take = doc.reading.takes.find((t) => t.id === takeId)
  if (!take || !take.score?.newPassageBest || take.score.smooth === undefined) return false

  const day = take.day
  const score = take.score
  const alreadyAwardedToday = Boolean(doc.reading.days[day]?.bestAwardedAt)

  update('reading', (reading) => ({
    ...reading,
    passageBests: {
      ...reading.passageBests,
      [take.passageId]: {
        smooth: score.smooth as number,
        wcpm: score.wcpm,
        accuracy: score.accuracy,
        takeId: take.id,
        day,
      },
    },
    days: alreadyAwardedToday ? reading.days : { ...reading.days, [day]: { ...reading.days[day], bestAwardedAt: Date.now() } },
  }))

  if (alreadyAwardedToday) return false
  grantToken('silver')
  return true
}

/**
 * Records the parent's 1-3 star rating for a day, once per day. 3 stars
 * awards a gold token, 2 silver, 1 nothing extra. Returns the tier awarded
 * (or null for 1 star / no token), and returns null *without changing
 * anything* if that day was already rated.
 */
export function setParentStars(day: string, stars: 1 | 2 | 3): Tier | null {
  // Same pre-check as awardReadIfGoalReached: no doc write unless something changes.
  if (getDoc().reading.days[day]?.parentStars) return null
  update('reading', (reading) => ({
    ...reading,
    days: { ...reading.days, [day]: { ...reading.days[day], parentStars: stars, parentRatedAt: Date.now() } },
  }))

  const tier = tokenForParentStars(stars)
  if (tier) grantToken(tier)
  return tier
}

/**
 * Grown-up control: gives (+1) or takes away (-1) one box token of a tier.
 * Never goes below zero, never touches XP, and writes nothing when there is
 * nothing to change. Returns the new count.
 */
export function adjustTokens(tier: Tier, delta: 1 | -1): number {
  const current = getDoc().profile.tokens[tier]
  const next = Math.max(0, current + delta)
  if (next === current) return current
  update('profile', (profile) => ({ ...profile, tokens: { ...profile.tokens, [tier]: next } }))
  return next
}

export function useReading(): ReadingSection {
  return useProgress().reading
}

// Re-exported so callers that only need "today" don't need a separate import.
export { localDay }
