import { describe, expect, it } from 'vitest'
import {
  daysNeedingParentRating,
  goalProgress,
  goalReached,
  readsForDay,
  stickerForStars,
  tokenForParentStars,
} from '../readingRewards'
import type { ReadingDay, ReadingTake } from '../progress'

function take(overrides: Partial<ReadingTake> = {}): ReadingTake {
  return {
    id: 'take-1',
    day: '2026-09-07',
    passageId: 'l1-cat-nap',
    startedAt: 0,
    durationSec: 30,
    mimeType: 'audio/mp4',
    sizeBytes: 1,
    hasAudio: true,
    deviceId: 'd',
    ...overrides,
  }
}

describe('readsForDay', () => {
  it('counts a take with no score yet (optimistic while the ear is pending)', () => {
    expect(readsForDay([take()], '2026-09-07')).toBe(1)
  })

  it('never counts a noReading take', () => {
    const t = take({
      score: {
        outcome: 'noReading',
        stars: 0,
        attempted: 0,
        read: 0,
        stumbled: 0,
        different: 0,
        skipped: 3,
        accuracy: 0,
        cleanAccuracy: 0,
        coverage: 0,
        wcpm: 0,
        trickyWords: [],
        newPassageBest: false,
      },
    })
    expect(readsForDay([t], '2026-09-07')).toBe(0)
  })

  it('only counts takes on the given day', () => {
    const takes = [take({ id: 'a', day: '2026-09-06' }), take({ id: 'b', day: '2026-09-07' })]
    expect(readsForDay(takes, '2026-09-07')).toBe(1)
  })

  it('never counts a word-practice take ("Try just this word")', () => {
    const takes = [take({ id: 'a', passageId: 'word:cat' }), take({ id: 'b', passageId: 'l1-cat-nap' })]
    expect(readsForDay(takes, '2026-09-07')).toBe(1)
  })
})

describe('goalReached / goalProgress', () => {
  it('is reached at exactly readsPerDay, not before', () => {
    expect(goalReached(2, 3)).toBe(false)
    expect(goalReached(3, 3)).toBe(true)
    expect(goalReached(4, 3)).toBe(true)
  })

  it('goalProgress is clamped to 0..1 and never divides by zero', () => {
    expect(goalProgress(-1, 3)).toBe(0)
    expect(goalProgress(0, 3)).toBe(0)
    expect(goalProgress(1, 2)).toBeCloseTo(0.5)
    expect(goalProgress(5, 3)).toBe(1)
    expect(goalProgress(0, 0)).toBe(1)
  })
})

describe('daysNeedingParentRating', () => {
  it('lists only days within the window that have a real read and no parentStars, newest first', () => {
    const takes = [
      take({ id: 'a', day: '2026-09-01' }), // outside a 3-day lookback from the 7th
      take({ id: 'b', day: '2026-09-05' }),
      take({ id: 'c', day: '2026-09-06' }),
    ]
    const days: Record<string, ReadingDay> = { '2026-09-06': { parentStars: 3, parentRatedAt: 1 } }
    expect(daysNeedingParentRating(takes, days, '2026-09-07', 3)).toEqual(['2026-09-05'])
  })

  it('never surfaces today itself', () => {
    const takes = [take({ day: '2026-09-07' })]
    expect(daysNeedingParentRating(takes, {}, '2026-09-07', 14)).toEqual([])
  })

  it('excludes a day whose only take was noReading', () => {
    const t = take({
      day: '2026-09-06',
      score: {
        outcome: 'noReading',
        stars: 0,
        attempted: 0,
        read: 0,
        stumbled: 0,
        different: 0,
        skipped: 3,
        accuracy: 0,
        cleanAccuracy: 0,
        coverage: 0,
        wcpm: 0,
        trickyWords: [],
        newPassageBest: false,
      },
    })
    expect(daysNeedingParentRating([t], {}, '2026-09-07', 14)).toEqual([])
  })
})

describe('tokenForParentStars', () => {
  it('3 stars = gold, 2 = silver, 1 = nothing', () => {
    expect(tokenForParentStars(3)).toBe('gold')
    expect(tokenForParentStars(2)).toBe('silver')
    expect(tokenForParentStars(1)).toBeNull()
  })
})

describe('stickerForStars', () => {
  it('returns null for anything less than 3 stars', () => {
    expect(stickerForStars(0)).toBeNull()
    expect(stickerForStars(1)).toBeNull()
    expect(stickerForStars(2)).toBeNull()
  })

  it('always returns a sticker for a 3-star read', () => {
    for (let i = 0; i < 10; i++) {
      expect(stickerForStars(3, () => i / 10)).not.toBeNull()
    }
  })
})
