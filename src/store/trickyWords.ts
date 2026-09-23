// Tricky-word bookkeeping: which words to offer on the Tricky words screen,
// and the per-word practice tally that eventually retires one. Pure logic
// (aggregateTricky/activeTricky take the section as a plain argument, no
// global reads) plus the side-effecting recordPractice() and one React hook.

import { normalizeWord } from '../content/textSplit'
import { update, useProgress, type ReadingSection } from './progress'
import { dayOffset, localDay } from './sessions'

export interface TrickyEntry {
  word: string
  count: number
  lastDay: string
  tries: number
  ok: number
  retired: boolean
}

const DEFAULT_WINDOW_DAYS = 14
const DEFAULT_MAX = 5
const RETIRE_AT_OK = 3

/**
 * Every word that showed up in a take's `score.trickyWords` within the last
 * `windowDays` (inclusive of `today`), normalized and de-duplicated, merged
 * with `reading.practice` for its tries/ok/retired state. Sorted by how
 * often it came up (most first), then most recently seen first. A word past
 * `RETIRE_AT_OK` successful practice tries is still listed here, marked
 * `retired` - activeTricky() is what hides it from the practice screen.
 */
export function aggregateTricky(reading: ReadingSection, today: string, windowDays: number = DEFAULT_WINDOW_DAYS): TrickyEntry[] {
  const cutoff = dayOffset(today, -(windowDays - 1))
  const counts = new Map<string, { display: string; count: number; lastDay: string }>()

  for (const take of reading.takes) {
    if (take.day < cutoff || take.day > today) continue
    const words = take.score?.trickyWords ?? []
    for (const raw of words) {
      const norm = normalizeWord(raw)
      if (norm === '') continue
      const existing = counts.get(norm)
      if (existing) {
        existing.count += 1
        if (take.day > existing.lastDay) existing.lastDay = take.day
      } else {
        counts.set(norm, { display: raw, count: 1, lastDay: take.day })
      }
    }
  }

  const entries: TrickyEntry[] = []
  for (const [norm, agg] of counts) {
    const practice = reading.practice[norm]
    const ok = practice?.ok ?? 0
    entries.push({
      word: agg.display,
      count: agg.count,
      lastDay: agg.lastDay,
      tries: practice?.tries ?? 0,
      ok,
      retired: ok >= RETIRE_AT_OK,
    })
  }

  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    if (a.lastDay === b.lastDay) return 0
    return a.lastDay < b.lastDay ? 1 : -1
  })
  return entries
}

/** aggregateTricky(), minus retired words, capped to `max` (default 5) - what the Tricky words screen offers. */
export function activeTricky(reading: ReadingSection, today: string, max: number = DEFAULT_MAX): TrickyEntry[] {
  return aggregateTricky(reading, today).filter((e) => !e.retired).slice(0, max)
}

export interface RecordPracticeDeps {
  now?: () => number
}

/** Bumps reading.practice[normalized word] after one mini-practice take: tries+1, ok+1 when it went well. */
export function recordPractice(word: string, ok: boolean, deps: RecordPracticeDeps = {}): void {
  const norm = normalizeWord(word)
  if (norm === '') return
  const now = deps.now ?? Date.now
  update('reading', (reading) => {
    const current = reading.practice[norm] ?? { tries: 0, ok: 0, lastAt: 0 }
    return {
      ...reading,
      practice: {
        ...reading.practice,
        [norm]: { tries: current.tries + 1, ok: current.ok + (ok ? 1 : 0), lastAt: now() },
      },
    }
  })
}

/** React hook: today's active (non-retired) tricky words, for the Tricky words screen. */
export function useTrickyWords(max: number = DEFAULT_MAX): TrickyEntry[] {
  const reading = useProgress().reading
  return activeTricky(reading, localDay(), max)
}
