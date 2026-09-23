import type { Streak } from './progress'

// ---------------------------------------------------------------------------
// Shared day/streak/clock helpers. `localDay` deliberately reads the *local*
// calendar day (year/month/date getters), not `toISOString()` (UTC) - late-
// evening practice must log as today, not tomorrow.
// ---------------------------------------------------------------------------

/** The local calendar day (YYYY-MM-DD) for `d`, defaulting to now. */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** The local day `deltaDays` away from `day` (negative = earlier). */
export function dayOffset(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + deltaDays)
  return localDay(date)
}

/** The last `n` local days (oldest first), ending at `today`. */
export function lastNDays(n: number, today: string = localDay()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(dayOffset(today, -i))
  return out
}

/**
 * Advances a streak for a read logged on `today`: continues it if the
 * last read was yesterday, leaves it unchanged if it was already today,
 * and otherwise restarts it at 1. `best` tracks the highest `current` ever
 * reached.
 */
export function bumpStreak(streak: Streak, today: string): Streak {
  const yesterday = dayOffset(today, -1)
  let current: number
  if (streak.lastDay === yesterday) current = streak.current + 1
  else if (streak.lastDay === today) current = streak.current
  else current = 1
  return { current, best: Math.max(streak.best, current), lastDay: today }
}

/** How many days back a forgiven gap may reach (once used, another 7 days pass before it can be used again). */
const FREEZE_LOOKBACK_DAYS = 7

/**
 * Like bumpStreak, but forgives exactly one missed day per rolling week: if
 * the last read was yesterday, or today already, this behaves identically
 * to bumpStreak. If exactly one day was missed (the last read was two days
 * ago) AND the freeze hasn't been used in the last `FREEZE_LOOKBACK_DAYS`
 * days, the streak still continues (+1) and `freezeUsedOn` is stamped to
 * `today` so the same forgiveness can't be spent again this week. Any wider
 * gap, or a one-day gap with the freeze already spent recently, restarts the
 * streak at 1 (and leaves `freezeUsedOn` untouched).
 */
export function bumpStreakForgiving(streak: Streak, today: string): Streak {
  const yesterday = dayOffset(today, -1)
  if (streak.lastDay === yesterday || streak.lastDay === today) {
    return bumpStreak(streak, today)
  }

  const twoDaysAgo = dayOffset(today, -2)
  const freezeRecentlyUsed =
    !!streak.freezeUsedOn && dayOffset(today, -FREEZE_LOOKBACK_DAYS) <= streak.freezeUsedOn && streak.freezeUsedOn < today

  if (streak.lastDay === twoDaysAgo && !freezeRecentlyUsed) {
    const current = streak.current + 1
    return { current, best: Math.max(streak.best, current), lastDay: today, freezeUsedOn: today }
  }

  return { current: 1, best: Math.max(streak.best, 1), lastDay: today, freezeUsedOn: streak.freezeUsedOn }
}

/** Formats a duration in seconds as `M:SS`. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
