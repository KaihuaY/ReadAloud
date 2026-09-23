import { describe, expect, it } from 'vitest'
import { pickTrickyWords, scoreTake, starsFor, validateEar } from '../readingScore'
import type { EarResult, PassageBest, WordStatus } from '../progress'

function makeEar(words: { i: number; w: string; s: WordStatus; heard?: string }[], overrides: Partial<EarResult> = {}): EarResult {
  return {
    words,
    extraWords: [],
    readSeconds: 10,
    confidence: 0.9,
    transcript: words
      .filter((w) => w.s === 'read')
      .map((w) => w.w)
      .join(' '),
    at: 1000,
    ...overrides,
  }
}

function readWords(count: number, statusOverrides: Record<number, WordStatus> = {}): { i: number; w: string; s: WordStatus }[] {
  return Array.from({ length: count }, (_, i) => ({ i, w: `w${i}`, s: statusOverrides[i] ?? 'read' }))
}

describe('starsFor', () => {
  it('is 3 at accuracy >= 0.90 for a full read', () => {
    expect(starsFor(0.9, 'full')).toBe(3)
    expect(starsFor(1, 'full')).toBe(3)
  })
  it('is 2 just under the 0.90 threshold', () => {
    expect(starsFor(0.8999, 'full')).toBe(2)
  })
  it('is 2 at accuracy >= 0.70', () => {
    expect(starsFor(0.7, 'full')).toBe(2)
  })
  it('is 1 just under the 0.70 threshold', () => {
    expect(starsFor(0.6999, 'full')).toBe(1)
  })
  it('is never 0 for a real (full) attempt, even at 0 accuracy', () => {
    expect(starsFor(0, 'full')).toBe(1)
  })
  it('caps a partial outcome at 2 stars even with perfect accuracy', () => {
    expect(starsFor(1, 'partial')).toBe(2)
    expect(starsFor(0.5, 'partial')).toBe(1)
  })
  it('is always 0 for noReading, regardless of accuracy', () => {
    expect(starsFor(1, 'noReading')).toBe(0)
  })
  it('is always 1 for unsure, regardless of accuracy', () => {
    expect(starsFor(1, 'unsure')).toBe(1)
    expect(starsFor(0, 'unsure')).toBe(1)
  })
})

describe('scoreTake outcomes', () => {
  const expected5 = ['a', 'b', 'c', 'd', 'e']

  it('is noReading when confidence < 0.35, even with full coverage', () => {
    const ear = makeEar(readWords(5), { confidence: 0.2 })
    const score = scoreTake(ear, expected5, 20)
    expect(score.outcome).toBe('noReading')
    expect(score.stars).toBe(0)
    expect(score.trickyWords).toEqual([])
  })

  it('is noReading when attempted < min(3, expected.length), even with high confidence', () => {
    const ear = makeEar(readWords(5, { 2: 'skipped', 3: 'skipped', 4: 'skipped' }), { confidence: 0.9 })
    const score = scoreTake(ear, expected5, 20)
    expect(score.attempted).toBe(2)
    expect(score.outcome).toBe('noReading')
    expect(score.stars).toBe(0)
  })

  it('is unsure when ear.unsure is set, with 1 star and no tricky words', () => {
    const ear = makeEar(readWords(10), { unsure: true, confidence: 0.9 })
    const score = scoreTake(ear, Array.from({ length: 10 }, (_, i) => `w${i}`), 20)
    expect(score.outcome).toBe('unsure')
    expect(score.stars).toBe(1)
    expect(score.trickyWords).toEqual([])
  })

  it('is partial when coverage < 0.6, scored on attempted words only, stars capped at 2', () => {
    const expected10 = Array.from({ length: 10 }, (_, i) => `w${i}`)
    const words = [
      ...readWords(5),
      ...Array.from({ length: 5 }, (_, i) => ({ i: i + 5, w: `w${i + 5}`, s: 'skipped' as WordStatus })),
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const score = scoreTake(ear, expected10, 20)
    expect(score.coverage).toBeCloseTo(0.5)
    expect(score.outcome).toBe('partial')
    expect(score.attempted).toBe(5)
    expect(score.stars).toBe(2) // accuracy 1.0 would be 3 stars on a full read, capped to 2 here
  })

  it('is full when coverage >= 0.6 and not unsure/noReading', () => {
    const ear = makeEar(readWords(10), { confidence: 0.9 })
    const expected10 = Array.from({ length: 10 }, (_, i) => `w${i}`)
    const score = scoreTake(ear, expected10, 20)
    expect(score.outcome).toBe('full')
    expect(score.stars).toBe(3)
  })
})

describe('scoreTake counts', () => {
  it('accuracy is (read+stumbled)/attempted, cleanAccuracy is read/attempted', () => {
    const words: { i: number; w: string; s: WordStatus }[] = [
      { i: 0, w: 'a', s: 'read' },
      { i: 1, w: 'b', s: 'stumbled' },
      { i: 2, w: 'c', s: 'different' },
      { i: 3, w: 'd', s: 'read' },
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const score = scoreTake(ear, ['a', 'b', 'c', 'd'], 20)
    expect(score.attempted).toBe(4)
    expect(score.read).toBe(2)
    expect(score.stumbled).toBe(1)
    expect(score.different).toBe(1)
    expect(score.accuracy).toBeCloseTo(0.75) // (2+1)/4
    expect(score.cleanAccuracy).toBeCloseTo(0.5) // 2/4
  })

  it('excludes skipped words after the attempted range from every count', () => {
    const words: { i: number; w: string; s: WordStatus }[] = [
      { i: 0, w: 'a', s: 'read' },
      { i: 1, w: 'b', s: 'skipped' },
      { i: 2, w: 'c', s: 'read' },
      { i: 3, w: 'd', s: 'skipped' },
      { i: 4, w: 'e', s: 'skipped' },
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const score = scoreTake(ear, ['a', 'b', 'c', 'd', 'e'], 20)
    // Last non-skipped index is 2, so attempted = 3; the trailing two skips (3, 4) don't count.
    expect(score.attempted).toBe(3)
    expect(score.read).toBe(2)
    expect(score.skipped).toBe(1) // only index 1, not indices 3 and 4
  })
})

describe('scoreTake wcpm', () => {
  const expected5 = ['a', 'b', 'c', 'd', 'e']

  it('clamps readSeconds up to a minimum of 3', () => {
    const ear = makeEar(readWords(5), { readSeconds: 1, confidence: 0.9 })
    const score = scoreTake(ear, expected5, 20)
    // clampedSeconds = 3 (readSeconds 1 clamped up); wcpm = 5/3*60 = 100
    expect(score.wcpm).toBe(100)
  })

  it('clamps readSeconds down to durationSec (but never below 3)', () => {
    const ear = makeEar(readWords(5), { readSeconds: 100, confidence: 0.9 })
    const score = scoreTake(ear, expected5, 10)
    // clampedSeconds = min(100, max(3,10)) = 10; wcpm = 5/10*60 = 30
    expect(score.wcpm).toBe(30)
  })

  it('caps wcpm at 200', () => {
    const expected20 = Array.from({ length: 20 }, (_, i) => `w${i}`)
    const ear = makeEar(readWords(20), { readSeconds: 3, confidence: 0.9 })
    const score = scoreTake(ear, expected20, 60)
    // raw = 20/3*60 = 400, capped to 200
    expect(score.wcpm).toBe(200)
  })
})

describe('scoreTake smooth + newPassageBest', () => {
  const expected10 = Array.from({ length: 10 }, (_, i) => `w${i}`)

  it('sets smooth only for a full read with accuracy >= 0.8', () => {
    const ear = makeEar(readWords(10, { 8: 'stumbled', 9: 'different' }), { readSeconds: 10, confidence: 0.9 })
    // accuracy = (8 read + 1 stumbled)/10 = 0.9 -> full, >= 0.8
    const score = scoreTake(ear, expected10, 20)
    expect(score.outcome).toBe('full')
    expect(score.accuracy).toBeCloseTo(0.9)
    expect(score.smooth).toBe(Math.round(score.wcpm * score.accuracy))
    expect(score.smooth).toBeGreaterThan(0)
  })

  it('is 0 when the read is full but accuracy is under 0.8', () => {
    const ear = makeEar(
      readWords(10, { 5: 'different', 6: 'different', 7: 'different', 8: 'different', 9: 'different' }),
      { confidence: 0.9 },
    )
    // accuracy = 5/10 = 0.5, still full outcome (coverage 1.0)
    const score = scoreTake(ear, expected10, 20)
    expect(score.outcome).toBe('full')
    expect(score.accuracy).toBeCloseTo(0.5)
    expect(score.smooth).toBe(0)
  })

  it('is 0 for a partial read even at perfect accuracy', () => {
    const words = [
      ...readWords(5),
      ...Array.from({ length: 5 }, (_, i) => ({ i: i + 5, w: `w${i + 5}`, s: 'skipped' as WordStatus })),
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const score = scoreTake(ear, expected10, 20)
    expect(score.coverage).toBeCloseTo(0.5) // strictly under the 0.6 partial threshold
    expect(score.outcome).toBe('partial')
    expect(score.smooth).toBe(0)
  })

  it('newPassageBest requires beating the previous best smooth by more than 5%', () => {
    const ear = makeEar(readWords(10), { readSeconds: 10, confidence: 0.9 })
    const score = scoreTake(ear, expected10, 20)
    const smooth = score.smooth ?? 0
    expect(smooth).toBeGreaterThan(0)

    // A prevBest exactly at (smooth / 1.05) means smooth === prevBest.smooth * 1.05 - a tie, not a beat.
    const tiedBest: PassageBest = { smooth: smooth / 1.05, wcpm: 0, accuracy: 0, takeId: 't', day: 'd' }
    expect(scoreTake(ear, expected10, 20, tiedBest).newPassageBest).toBe(false)

    const beatenBest: PassageBest = { smooth: Math.floor(smooth * 0.9), wcpm: 0, accuracy: 0, takeId: 't', day: 'd' }
    expect(scoreTake(ear, expected10, 20, beatenBest).newPassageBest).toBe(true)

    const higherBest: PassageBest = { smooth: smooth * 10, wcpm: 0, accuracy: 0, takeId: 't', day: 'd' }
    expect(scoreTake(ear, expected10, 20, higherBest).newPassageBest).toBe(false)
  })

  it('is a new best with no prevBest at all, as long as smooth > 0', () => {
    const ear = makeEar(readWords(10), { confidence: 0.9 })
    const score = scoreTake(ear, expected10, 20, undefined)
    expect(score.newPassageBest).toBe(true)
  })
})

describe('pickTrickyWords', () => {
  it('orders different, then skipped, then stumbled; prefers words >= 3 letters; unique; capped at max', () => {
    const expected = ['at', 'cat', 'sat', 'mat', 'dig', 'big']
    const words: { i: number; w: string; s: WordStatus }[] = [
      { i: 0, w: 'at', s: 'different' },
      { i: 1, w: 'cat', s: 'stumbled' },
      { i: 2, w: 'sat', s: 'different' },
      { i: 3, w: 'mat', s: 'skipped' },
      { i: 4, w: 'dig', s: 'stumbled' },
      { i: 5, w: 'big', s: 'read' },
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const tricky = pickTrickyWords(ear, expected, 3)
    expect(tricky).toEqual(['sat', 'mat', 'cat'])
  })

  it('is unique by normalized form', () => {
    const expected = ['Cat.', 'cat', 'dog']
    const words: { i: number; w: string; s: WordStatus }[] = [
      { i: 0, w: 'Cat.', s: 'different' },
      { i: 1, w: 'cat', s: 'different' },
      { i: 2, w: 'dog', s: 'stumbled' },
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const tricky = pickTrickyWords(ear, expected, 3)
    expect(tricky).toEqual(['Cat.', 'dog'])
  })

  it('falls back to short words only when there are fewer than max long ones', () => {
    // 'go' (read, index 2) keeps both short words inside the attempted range.
    const expected = ['at', 'it', 'go']
    const words: { i: number; w: string; s: WordStatus }[] = [
      { i: 0, w: 'at', s: 'different' },
      { i: 1, w: 'it', s: 'skipped' },
      { i: 2, w: 'go', s: 'read' },
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    const tricky = pickTrickyWords(ear, expected, 3)
    expect(tricky).toEqual(['at', 'it'])
  })

  it('never picks a word past the attempted range', () => {
    // Last non-skipped is index 2 ('six'), so attempted = 3; 'ten' and 'end'
    // (indices 3, 4 - unmentioned, so implicitly skipped) are past that
    // range and must never show up as tricky, even though 'skipped' is
    // normally a tricky-word bucket.
    const expected = ['one', 'two', 'six', 'ten', 'end']
    const words: { i: number; w: string; s: WordStatus }[] = [
      { i: 0, w: 'one', s: 'read' },
      { i: 1, w: 'two', s: 'skipped' },
      { i: 2, w: 'six', s: 'different' },
    ]
    const ear = makeEar(words, { confidence: 0.9 })
    expect(pickTrickyWords(ear, expected, 3)).toEqual(['six', 'two'])
  })
})

describe('validateEar', () => {
  const expected3 = ['a', 'b', 'c']

  it('returns null for garbage input', () => {
    expect(validateEar(null, expected3)).toBeNull()
    expect(validateEar(undefined, expected3)).toBeNull()
    expect(validateEar('nope', expected3)).toBeNull()
    expect(validateEar({}, expected3)).toBeNull()
    expect(validateEar({ words: 'not-an-array' }, expected3)).toBeNull()
  })

  it('fills a missing index with a skipped entry for that expected word', () => {
    const raw = { confidence: 0.9, readSeconds: 5, transcript: 'a', words: [{ i: 0, w: 'a', s: 'read' }], extraWords: [] }
    const result = validateEar(raw, expected3, () => 42)
    expect(result).not.toBeNull()
    expect(result!.words).toEqual([
      { i: 0, w: 'a', s: 'read' },
      { i: 1, w: 'b', s: 'skipped' },
      { i: 2, w: 'c', s: 'skipped' },
    ])
    expect(result!.at).toBe(42)
  })

  it('drops a duplicate index, keeping the first', () => {
    const raw = {
      confidence: 0.9,
      readSeconds: 5,
      transcript: 'a b c',
      words: [
        { i: 0, w: 'a', s: 'read' },
        { i: 0, w: 'a', s: 'stumbled' },
        { i: 1, w: 'b', s: 'read' },
        { i: 2, w: 'c', s: 'read' },
      ],
      extraWords: [],
    }
    const result = validateEar(raw, expected3)
    expect(result!.words[0].s).toBe('read')
  })

  it('drops an out-of-range index without throwing', () => {
    const raw = {
      confidence: 0.9,
      readSeconds: 5,
      transcript: 'a',
      words: [
        { i: 0, w: 'a', s: 'read' },
        { i: 99, w: 'ghost', s: 'read' },
      ],
      extraWords: [],
    }
    expect(() => validateEar(raw, expected3)).not.toThrow()
    const result = validateEar(raw, expected3)
    expect(result!.words).toHaveLength(3)
  })

  it('maps an unknown status to stumbled', () => {
    const raw = { confidence: 0.9, readSeconds: 5, transcript: 'a', words: [{ i: 0, w: 'a', s: 'weird-status' }], extraWords: [] }
    const result = validateEar(raw, expected3)
    expect(result!.words[0].s).toBe('stumbled')
  })

  it('clamps confidence into 0-1 and readSeconds to >= 0', () => {
    const raw = { confidence: 5, readSeconds: -10, transcript: '', words: [], extraWords: [] }
    const result = validateEar(raw, expected3)
    expect(result!.confidence).toBe(1)
    expect(result!.readSeconds).toBe(0)
  })

  it('is unsure when more than 20% of returned entries mismatch the expected word', () => {
    const expected5 = ['a', 'b', 'c', 'd', 'e']
    const mostlyRight = {
      confidence: 0.9,
      readSeconds: 5,
      transcript: 'a b c d e',
      words: [
        { i: 0, w: 'a', s: 'read' },
        { i: 1, w: 'b', s: 'read' },
        { i: 2, w: 'c', s: 'read' },
        { i: 3, w: 'd', s: 'read' },
        { i: 4, w: 'zzz', s: 'read' }, // 1/5 = 20%, not > 20%
      ],
      extraWords: [],
    }
    expect(validateEar(mostlyRight, expected5)!.unsure).toBeFalsy()

    const tooManyMismatches = {
      ...mostlyRight,
      words: [
        { i: 0, w: 'a', s: 'read' },
        { i: 1, w: 'b', s: 'read' },
        { i: 2, w: 'c', s: 'read' },
        { i: 3, w: 'zzz', s: 'read' },
        { i: 4, w: 'yyy', s: 'read' }, // 2/5 = 40% > 20%
      ],
    }
    expect(validateEar(tooManyMismatches, expected5)!.unsure).toBe(true)
  })

  it('is unsure when the transcript contains fewer than half the words marked read', () => {
    const raw = {
      confidence: 0.9,
      readSeconds: 5,
      transcript: 'completely unrelated mumbling',
      words: [
        { i: 0, w: 'a', s: 'read' },
        { i: 1, w: 'b', s: 'read' },
        { i: 2, w: 'c', s: 'read' },
        { i: 3, w: 'd', s: 'read' },
      ],
      extraWords: [],
    }
    const result = validateEar(raw, ['a', 'b', 'c', 'd'])
    expect(result!.unsure).toBe(true)
  })
})
