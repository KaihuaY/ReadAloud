// Personal records for reading: most reads in a day, longest streak,
// smoothest read, most passages with 3 stars. Pure functions over the takes
// (so past days count from day one), plus one store action that caches the
// result in `reading.records` and reports which records a fresh take just beat.

import { getDoc, update, useProgress, type ReadingTake, type RecordEntry, type Records, type Streak } from './progress'
import { readsForDay } from './readingRewards'
import { localDay } from './sessions'

export type RecordKey = keyof Records

export const RECORD_KEYS: RecordKey[] = ['mostReadsInDay', 'longestStreakDays', 'smoothestRead', 'passagesWithThreeStars']

/** Computes every record from scratch. */
export function computeRecords(reading: { takes: ReadingTake[]; streak: Streak }, now: number = Date.now()): Records {
  const takes = reading.takes
  const out: Records = {}

  const days = [...new Set(takes.map((t) => t.day))].sort()
  let bestDay: RecordEntry | undefined
  for (const day of days) {
    const count = readsForDay(takes, day)
    if (count > 0 && (!bestDay || count > bestDay.value)) bestDay = { value: count, day, setAt: now }
  }
  if (bestDay) out.mostReadsInDay = bestDay

  if (reading.streak.best > 0) {
    out.longestStreakDays = { value: reading.streak.best, day: reading.streak.lastDay, setAt: now }
  }

  let smoothest: { take: ReadingTake; smooth: number } | undefined
  for (const t of takes) {
    const smooth = t.score?.smooth
    if (smooth === undefined) continue
    if (!smoothest || smooth > smoothest.smooth) smoothest = { take: t, smooth }
  }
  if (smoothest) {
    out.smoothestRead = {
      value: Math.round(smoothest.smooth),
      day: smoothest.take.day,
      takeId: smoothest.take.id,
      passageId: smoothest.take.passageId,
      setAt: now,
    }
  }

  const threeStarPassageIds = new Set(takes.filter((t) => t.score?.stars === 3).map((t) => t.passageId))
  if (threeStarPassageIds.size > 0) {
    out.passagesWithThreeStars = { value: threeStarPassageIds.size, day: localDay(new Date(now)), setAt: now }
  }

  return out
}

/** Records in `next` that are strictly better than in `prev` (a missing `prev` entry counts as beaten only when `prev` itself exists). */
export function beatenRecords(prev: Records | undefined, next: Records): RecordKey[] {
  if (!prev) return []
  return RECORD_KEYS.filter((k) => next[k] && (!prev[k] || next[k]!.value > prev[k]!.value))
}

/**
 * Recomputes the records after a take was saved and caches them. Returns the
 * keys that were just beaten so the done screen can celebrate. The very first
 * computation (no cached records yet) writes silently: nothing is "new" about
 * history already there.
 */
export function updateRecords(): RecordKey[] {
  const doc = getDoc()
  const next = computeRecords(doc.reading)
  const prev = doc.reading.records
  const beaten = beatenRecords(prev, next)
  const changed = !prev || RECORD_KEYS.some((k) => (prev[k]?.value ?? -1) !== (next[k]?.value ?? -1))
  if (!changed) return []
  // Keep the original setAt for records that did not move, so "since 12 Sep" stays truthful.
  const merged: Records = {}
  for (const k of RECORD_KEYS) {
    const n = next[k]
    if (!n) continue
    const p = prev?.[k]
    merged[k] = p && p.value === n.value ? p : n
  }
  update('reading', (reading) => ({ ...reading, records: merged }))
  return beaten
}

/**
 * Records for display: the cached copy, or computed live from the takes
 * until the first take on this build caches them (so history shows at once).
 */
export function useRecords(): Records | undefined {
  const doc = useProgress()
  if (doc.reading.records) return doc.reading.records
  if (doc.reading.takes.length === 0) return undefined
  return computeRecords(doc.reading)
}

/** Kid-facing labels for each record. */
export const RECORD_LABELS: Record<RecordKey, { emoji: string; title: string }> = {
  mostReadsInDay: { emoji: '📅', title: 'Most reads in a day' },
  longestStreakDays: { emoji: '🔥', title: 'Longest streak' },
  smoothestRead: { emoji: '🎯', title: 'Smoothest read' },
  passagesWithThreeStars: { emoji: '⭐', title: 'Stories with 3 stars' },
}
