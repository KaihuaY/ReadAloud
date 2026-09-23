import { beforeEach, describe, expect, it } from 'vitest'
import {
  adjustTokens,
  awardPassageBestIfBeaten,
  awardReadIfGoalReached,
  isWordTake,
  markAudioPruned,
  passageTakes,
  saveTake,
  setParentStars,
  setTakeAi,
  setTakeEar,
  setTakeScore,
  setTakeWaveform,
  wordOfTake,
} from '../reading'
import { getDoc, resetAll, type ReadingTake, type TakeScore } from '../progress'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

let n = 0
function take(day: string, overrides: Partial<ReadingTake> = {}): ReadingTake {
  n++
  return {
    id: `t${n}`,
    day,
    passageId: 'l1-cat-nap',
    startedAt: Date.parse(day + 'T10:00:00') + n * 1000,
    durationSec: 30,
    mimeType: 'audio/mp4',
    sizeBytes: 1,
    hasAudio: true,
    deviceId: 'd',
    ...overrides,
  }
}

function noReadingScore(): TakeScore {
  return {
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
  }
}

function fullScore(overrides: Partial<TakeScore> = {}): TakeScore {
  return {
    outcome: 'full',
    stars: 3,
    attempted: 5,
    read: 5,
    stumbled: 0,
    different: 0,
    skipped: 0,
    accuracy: 1,
    cleanAccuracy: 1,
    coverage: 1,
    wcpm: 60,
    smooth: 60,
    trickyWords: [],
    newPassageBest: true,
    ...overrides,
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
  n = 0
})

describe('saveTake / setTakeEar / setTakeScore / setTakeAi / setTakeWaveform', () => {
  it('save then patch a take through each setter', () => {
    const t = take('2026-09-07')
    saveTake(t)
    expect(getDoc().reading.takes).toHaveLength(1)

    setTakeEar(t.id, { words: [], extraWords: [], readSeconds: 5, confidence: 0.9, transcript: 'the cat sat', at: 1 })
    expect(getDoc().reading.takes[0].ear?.transcript).toBe('the cat sat')
    expect(getDoc().reading.takes[0].earStatus).toBe('done')

    setTakeScore(t.id, fullScore())
    expect(getDoc().reading.takes[0].score?.stars).toBe(3)

    setTakeAi(t.id, { kid: { praise: 'Nice work!', tryNext: 'Try it again', trickyWords: [] }, source: 'rules', at: 2 })
    expect(getDoc().reading.takes[0].ai?.kid?.praise).toBe('Nice work!')

    setTakeAi(t.id, { parent: { note: 'Read smoothly.' }, source: 'rules', at: 3 })
    // Merges rather than clobbers the earlier kid feedback.
    expect(getDoc().reading.takes[0].ai?.kid?.praise).toBe('Nice work!')
    expect(getDoc().reading.takes[0].ai?.parent?.note).toBe('Read smoothly.')

    setTakeWaveform(t.id, [1, 2, 3])
    expect(getDoc().reading.takes[0].waveform).toEqual([1, 2, 3])
  })
})

describe('markAudioPruned', () => {
  it('flags the given takes hasAudio false and stamps audioPrunedAt', () => {
    saveTake(take('2026-09-07', { id: 'a' }))
    markAudioPruned(['a'], 999)
    const t = getDoc().reading.takes.find((x) => x.id === 'a')
    expect(t?.hasAudio).toBe(false)
    expect(t?.audioPrunedAt).toBe(999)
  })

  it('is a no-op for an empty list', () => {
    saveTake(take('2026-09-07', { id: 'a' }))
    const before = getDoc().reading.updatedAt
    markAudioPruned([])
    expect(getDoc().reading.updatedAt).toBe(before)
  })
})

describe('awardReadIfGoalReached', () => {
  it('awards a bronze token and bumps the streak exactly once per day', () => {
    saveTake(take('2026-09-07'))
    saveTake(take('2026-09-07'))
    saveTake(take('2026-09-07')) // 3rd read - readsPerDay defaults to 3

    expect(awardReadIfGoalReached('2026-09-07')).toBe(true)
    expect(getDoc().profile.tokens.bronze).toBe(1)
    expect(getDoc().reading.streak.current).toBe(1)
    expect(getDoc().reading.days['2026-09-07']?.goalReachedAt).toBeGreaterThan(0)

    // Calling again the same day is a no-op - no doc write, no second token.
    const beforeUpdatedAt = getDoc().reading.updatedAt
    expect(awardReadIfGoalReached('2026-09-07')).toBe(false)
    expect(getDoc().profile.tokens.bronze).toBe(1)
    expect(getDoc().reading.updatedAt).toBe(beforeUpdatedAt)
  })

  it('does not count toward the goal below the threshold', () => {
    saveTake(take('2026-09-07'))
    saveTake(take('2026-09-07'))
    expect(awardReadIfGoalReached('2026-09-07')).toBe(false)
    expect(getDoc().profile.tokens.bronze).toBe(0)
  })

  it('a noReading take never counts toward the goal', () => {
    saveTake(take('2026-09-07', { score: noReadingScore() }))
    saveTake(take('2026-09-07', { score: noReadingScore() }))
    saveTake(take('2026-09-07', { score: noReadingScore() }))
    expect(awardReadIfGoalReached('2026-09-07')).toBe(false)
  })

  it('an unscored take (ear still pending) counts optimistically toward the goal', () => {
    saveTake(take('2026-09-07'))
    saveTake(take('2026-09-07'))
    saveTake(take('2026-09-07'))
    expect(getDoc().reading.takes.every((t) => t.score === undefined)).toBe(true)
    expect(awardReadIfGoalReached('2026-09-07')).toBe(true)
  })
})

describe('awardPassageBestIfBeaten', () => {
  it('awards a silver token and records the passage best on a newPassageBest take', () => {
    const t = take('2026-09-07', { score: fullScore({ smooth: 70 }) })
    saveTake(t)

    expect(awardPassageBestIfBeaten(t.id)).toBe(true)
    expect(getDoc().profile.tokens.silver).toBe(1)
    expect(getDoc().reading.passageBests['l1-cat-nap']).toMatchObject({ smooth: 70, takeId: t.id })
  })

  it('does nothing for a take whose score is not flagged newPassageBest', () => {
    const t = take('2026-09-07', { score: fullScore({ newPassageBest: false }) })
    saveTake(t)
    expect(awardPassageBestIfBeaten(t.id)).toBe(false)
    expect(getDoc().profile.tokens.silver).toBe(0)
  })

  it('caps the token at once per day even if a second passage best happens the same day', () => {
    const t1 = take('2026-09-07', { score: fullScore({ smooth: 70 }) })
    saveTake(t1)
    expect(awardPassageBestIfBeaten(t1.id)).toBe(true)

    const t2 = take('2026-09-07', { passageId: 'l1-fat-cat', score: fullScore({ smooth: 90 }) })
    saveTake(t2)
    expect(awardPassageBestIfBeaten(t2.id)).toBe(false) // no second token today
    expect(getDoc().profile.tokens.silver).toBe(1)
    // But the passage-best record itself is still updated.
    expect(getDoc().reading.passageBests['l1-fat-cat']).toMatchObject({ smooth: 90 })
  })
})

describe('setParentStars', () => {
  it('awards gold for 3 stars, silver for 2, nothing for 1, once per day', () => {
    expect(setParentStars('2026-09-07', 3)).toBe('gold')
    expect(getDoc().profile.tokens.gold).toBe(1)
    // Same day again is a no-op.
    expect(setParentStars('2026-09-07', 2)).toBeNull()
    expect(getDoc().profile.tokens.silver).toBe(0)

    expect(setParentStars('2026-09-08', 1)).toBeNull()
    expect(getDoc().profile.tokens.gold).toBe(1)
    expect(getDoc().profile.tokens.silver).toBe(0)
  })
})

describe('adjustTokens', () => {
  it('adds and removes tokens, never below zero, and is a no-op removing from zero', () => {
    expect(adjustTokens('gold', 1)).toBe(1)
    expect(adjustTokens('gold', -1)).toBe(0)
    const before = getDoc().profile.updatedAt
    expect(adjustTokens('gold', -1)).toBe(0)
    expect(getDoc().profile.updatedAt).toBe(before)
  })
})

describe('isWordTake / wordOfTake', () => {
  it('recognizes a word-practice passageId and extracts the word', () => {
    expect(isWordTake({ passageId: 'word:cat' })).toBe(true)
    expect(wordOfTake('word:cat')).toBe('cat')
  })

  it('is false/null for a normal passage id', () => {
    expect(isWordTake({ passageId: 'l1-cat-nap' })).toBe(false)
    expect(wordOfTake('l1-cat-nap')).toBeNull()
  })

  it('treats an empty word as no word at all', () => {
    expect(wordOfTake('word:')).toBeNull()
  })
})

describe('passageTakes', () => {
  it('filters out word-practice takes, keeping real passage reads', () => {
    const passageTake = take('2026-09-07', { id: 'p1', passageId: 'l1-cat-nap' })
    const wordTake = take('2026-09-07', { id: 'w1', passageId: 'word:cat' })
    expect(passageTakes([passageTake, wordTake])).toEqual([passageTake])
  })
})
