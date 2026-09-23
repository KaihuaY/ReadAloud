// Pure, rng-injectable rules behind the daily reading goal, the parent
// day-rating reward, and the 3-star sticker drop. Kept free of the progress
// store and any React so reading.ts and the screens can share the exact
// same rules, and so they're trivial to unit test.

import { findSticker, STICKERS, type StickerDef } from '../content/stickers'
import type { Tier } from './rewards'
import type { ReadingDay, ReadingTake } from './progress'
import { dayOffset, localDay } from './sessions'

/**
 * How many of `takes` on local day `day` count toward the daily goal: every
 * take that day whose score says something real happened - a `noReading`
 * outcome never counts, but a take that hasn't been scored yet (the ear is
 * still pending, or scoring is disabled) counts optimistically so the ring
 * doesn't sit empty while she waits.
 */
export function readsForDay(takes: readonly ReadingTake[], day: string): number {
  return takes.filter((t) => t.day === day && t.score?.outcome !== 'noReading').length
}

/** Whether `count` reads meets or exceeds the daily goal. */
export function goalReached(count: number, readsPerDay: number): boolean {
  return count >= readsPerDay
}

/** 0-1 progress toward the daily goal, for the ring. */
export function goalProgress(count: number, readsPerDay: number): number {
  if (readsPerDay <= 0) return 1
  return Math.max(0, Math.min(1, count / readsPerDay))
}

/**
 * Local days (most recent first) in the last `lookbackDays` that had at
 * least one real read but no parent star rating yet - the Grown-ups review
 * queue. `today` is excluded (a day still in progress shouldn't nag for a
 * rating yet).
 */
export function daysNeedingParentRating(
  takes: readonly ReadingTake[],
  days: Record<string, ReadingDay>,
  today: string = localDay(),
  lookbackDays: number = 14,
): string[] {
  const out: string[] = []
  for (let i = 1; i <= lookbackDays; i++) {
    const day = dayOffset(today, -i)
    if (readsForDay(takes, day) === 0) continue
    if (days[day]?.parentStars) continue
    out.push(day)
  }
  return out
}

/** Which box token (if any) a parent's day rating awards: 3 stars = gold, 2 = silver, 1 = nothing extra. */
export function tokenForParentStars(stars: 1 | 2 | 3): Tier | null {
  if (stars === 3) return 'gold'
  if (stars === 2) return 'silver'
  return null
}

/** Picks the emoji sticker a 3-star read drops, or null for anything less. */
export function stickerForStars(stars: 0 | 1 | 2 | 3, rng: () => number = Math.random): StickerDef | null {
  if (stars !== 3) return null
  const weights = STICKERS.map((s) => s.weight)
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return findSticker(STICKERS[0]?.id) ?? null
  let roll = rng() * total
  for (let i = 0; i < STICKERS.length; i++) {
    if (roll < weights[i]) return STICKERS[i]
    roll -= weights[i]
  }
  return STICKERS[STICKERS.length - 1] ?? null
}
