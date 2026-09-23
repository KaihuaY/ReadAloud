import { describe, expect, it } from 'vitest'
import { classifySituation, levelHint, rulePhrases, stableHash, type RulePhraseContext } from '../readingPhrases'
import type { TakeScore } from '../../store/progress'

const BANNED_WORDS = ['wrong', 'bad', 'mistake', 'error', 'fail', 'failed', 'lazy', 'slow', 'stupid']

function score(overrides: Partial<TakeScore> = {}): TakeScore {
  return {
    outcome: 'full',
    stars: 3,
    attempted: 10,
    read: 8,
    stumbled: 2,
    different: 0,
    skipped: 0,
    accuracy: 1,
    cleanAccuracy: 0.8,
    coverage: 1,
    wcpm: 40,
    trickyWords: [],
    newPassageBest: false,
    ...overrides,
  }
}

const CTX: RulePhraseContext = {
  takeId: 'take-1',
  kidFirstName: 'Mia',
  passageTitle: 'Cat and Hat',
  score: score(),
  level: 2,
}

function countSentences(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '').length
}

function assertNoBannedContent(text: string): void {
  const lower = text.toLowerCase()
  for (const word of BANNED_WORDS) {
    expect(lower).not.toMatch(new RegExp(`\\b${word}\\b`))
  }
  expect(text).not.toContain('%')
  expect(lower).not.toContain('wpm')
  expect(lower).not.toContain('per minute')
  expect(lower).not.toContain('i heard')
  expect(lower).not.toContain('i listened')
}

describe('classifySituation', () => {
  it('is noReading/unsure/partial straight from the outcome, regardless of other fields', () => {
    expect(classifySituation({ ...CTX, score: score({ outcome: 'noReading', newPassageBest: true, accuracy: 1 }) })).toBe('noReading')
    expect(classifySituation({ ...CTX, score: score({ outcome: 'unsure' }) })).toBe('unsure')
    expect(classifySituation({ ...CTX, score: score({ outcome: 'partial' }) })).toBe('partial')
  })

  it('is smoother when newPassageBest is true', () => {
    expect(classifySituation({ ...CTX, score: score({ newPassageBest: true, accuracy: 0.5 }) })).toBe('smoother')
  })

  it('is cleanRun when accuracy >= 0.9 and no new best', () => {
    expect(classifySituation({ ...CTX, score: score({ accuracy: 0.95, newPassageBest: false }) })).toBe('cleanRun')
  })

  it('is fewerTricky when previous exists and different+skipped dropped', () => {
    const previous = score({ accuracy: 0.5, different: 3, skipped: 1 })
    const current = score({ accuracy: 0.5, different: 1, skipped: 0, newPassageBest: false })
    expect(classifySituation({ ...CTX, score: current, previous })).toBe('fewerTricky')
  })

  it('is not fewerTricky when there is no improvement', () => {
    const previous = score({ accuracy: 0.5, different: 1, skipped: 0 })
    const current = score({ accuracy: 0.5, different: 1, skipped: 0, newPassageBest: false })
    expect(classifySituation({ ...CTX, score: current, previous })).not.toBe('fewerTricky')
  })

  it('is soundedOut when stumbled >= 2 and different === 0, and nothing stronger applies', () => {
    const current = score({ accuracy: 0.5, stumbled: 2, different: 0, newPassageBest: false })
    expect(classifySituation({ ...CTX, score: current })).toBe('soundedOut')
  })

  it('falls back to generic otherwise', () => {
    const current = score({ accuracy: 0.5, stumbled: 0, different: 1, newPassageBest: false })
    expect(classifySituation({ ...CTX, score: current })).toBe('generic')
  })
})

describe('levelHint', () => {
  it('is up when 5 or more recent values are all >= 0.95', () => {
    expect(levelHint([0.96, 0.97, 1, 0.95, 0.99])).toBe('up')
  })

  it('is not up when fewer than 5 values are given', () => {
    expect(levelHint([1, 1, 1, 1])).toBe('stay')
  })

  it('is not up when one value falls below the threshold', () => {
    expect(levelHint([0.96, 0.97, 1, 0.9, 0.99])).toBe('stay')
  })

  it('is down when 3 or more recent values are all < 0.6', () => {
    expect(levelHint([0.5, 0.4, 0.55])).toBe('down')
  })

  it('is not down when fewer than 3 values are given', () => {
    expect(levelHint([0.5, 0.4])).toBe('stay')
  })

  it('is stay for a mixed or empty run', () => {
    expect(levelHint([0.5, 0.9, 0.95])).toBe('stay')
    expect(levelHint([])).toBe('stay')
  })
})

describe('stableHash', () => {
  it('is deterministic for the same string', () => {
    expect(stableHash('take-abc')).toBe(stableHash('take-abc'))
  })

  it('is a non-negative integer', () => {
    expect(Number.isInteger(stableHash('take-abc'))).toBe(true)
    expect(stableHash('take-abc')).toBeGreaterThanOrEqual(0)
  })
})

describe('rulePhrases', () => {
  it('is deterministic: the same takeId + inputs always renders the same result', () => {
    const a = rulePhrases(CTX)
    const b = rulePhrases(CTX)
    expect(a).toEqual(b)
  })

  it('different takeIds cover more than one variant', () => {
    const texts = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const r = rulePhrases({ ...CTX, takeId: `take-${i}` })
      texts.add(r.kid.praise)
    }
    expect(texts.size).toBeGreaterThan(1)
  })

  it('different takeIds cover every praise variant for a fixed situation (soundedOut has 3)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const r = rulePhrases({ ...CTX, takeId: `t${i}`, score: score({ accuracy: 0.5, stumbled: 2, different: 0, newPassageBest: false }) })
      expect(r.situation).toBe('soundedOut')
      seen.add(r.kid.praise)
    }
    expect(seen.size).toBe(3)
  })

  const situations: { name: string; ctx: RulePhraseContext }[] = [
    { name: 'noReading', ctx: { ...CTX, score: score({ outcome: 'noReading', attempted: 0, read: 0, stumbled: 0, accuracy: 0, coverage: 0, wcpm: 0 }) } },
    { name: 'unsure', ctx: { ...CTX, score: score({ outcome: 'unsure', accuracy: 0.4 }) } },
    { name: 'partial', ctx: { ...CTX, score: score({ outcome: 'partial', accuracy: 0.5, stars: 1 }) } },
    { name: 'smoother', ctx: { ...CTX, score: score({ newPassageBest: true, accuracy: 0.7 }) } },
    { name: 'cleanRun', ctx: { ...CTX, score: score({ accuracy: 0.95, newPassageBest: false }) } },
    {
      name: 'fewerTricky',
      ctx: {
        ...CTX,
        score: score({ accuracy: 0.5, different: 1, skipped: 0, newPassageBest: false, trickyWords: ['mat'] }),
        previous: score({ accuracy: 0.5, different: 3, skipped: 1 }),
      },
    },
    { name: 'soundedOut', ctx: { ...CTX, score: score({ accuracy: 0.5, stumbled: 2, different: 0, newPassageBest: false }) } },
    { name: 'generic', ctx: { ...CTX, score: score({ accuracy: 0.5, stumbled: 0, different: 1, newPassageBest: false }) } },
  ]

  for (const { name, ctx } of situations) {
    it(`[${name}] praise is <= 2 sentences, tryNext is exactly 1 sentence ending in . ! or ?, parent note is 3-5 sentences, nothing banned`, () => {
      for (let i = 0; i < 10; i++) {
        const r = rulePhrases({ ...ctx, takeId: `${name}-${i}` })
        expect(countSentences(r.kid.praise)).toBeLessThanOrEqual(2)
        expect(countSentences(r.kid.tryNext)).toBe(1)
        expect(r.kid.tryNext.trim()).toMatch(/[.!?]$/)
        const noteSentences = countSentences(r.parent.note)
        expect(noteSentences).toBeGreaterThanOrEqual(3)
        expect(noteSentences).toBeLessThanOrEqual(5)
        assertNoBannedContent(r.kid.praise)
        assertNoBannedContent(r.kid.tryNext)
        assertNoBannedContent(r.parent.note)
      }
    })
  }

  it('trickyWords is empty for noReading and unsure, even when score.trickyWords is not', () => {
    const noReading = rulePhrases({ ...CTX, score: score({ outcome: 'noReading', trickyWords: ['cat', 'mat'] }) })
    expect(noReading.kid.trickyWords).toEqual([])
    const unsure = rulePhrases({ ...CTX, score: score({ outcome: 'unsure', trickyWords: ['cat'] }) })
    expect(unsure.kid.trickyWords).toEqual([])
  })

  it('trickyWords otherwise mirrors score.trickyWords', () => {
    const r = rulePhrases({ ...CTX, score: score({ trickyWords: ['cat', 'mat'] }) })
    expect(r.kid.trickyWords).toEqual(['cat', 'mat'])
  })

  it('at most one emoji across the kid note', () => {
    const emojiPattern = /\p{Extended_Pictographic}/gu
    for (const { ctx } of situations) {
      const r = rulePhrases(ctx)
      const combined = `${r.kid.praise} ${r.kid.tryNext}`
      const count = (combined.match(emojiPattern) ?? []).length
      expect(count).toBeLessThanOrEqual(1)
    }
  })

  it('parent note cites the words-correct-of-attempted count and the pace', () => {
    const r = rulePhrases({ ...CTX, score: score({ attempted: 10, read: 8, stumbled: 1, wcpm: 45 }) })
    expect(r.parent.note).toContain('9 of 10')
    expect(r.parent.note).toMatch(/45/)
  })

  it('parent note lists the tricky words by name, or says there were none', () => {
    const withTricky = rulePhrases({ ...CTX, score: score({ trickyWords: ['mat', 'sat'] }) })
    expect(withTricky.parent.note).toContain('mat')
    expect(withTricky.parent.note).toContain('sat')
    const clean = rulePhrases({ ...CTX, score: score({ trickyWords: [] }) })
    expect(clean.parent.note.toLowerCase()).toContain('no words to practise')
  })

  it('parent note compares with the previous take when given', () => {
    const previous = score({ accuracy: 0.6 })
    const better = rulePhrases({ ...CTX, score: score({ accuracy: 0.9, newPassageBest: false }), previous })
    expect(better.parent.note.toLowerCase()).toMatch(/more accurate|last read/)
  })

  it('parent note includes a level line only when wordsAtLevelRecentAccuracy is given', () => {
    const without = rulePhrases(CTX)
    expect(without.parent.note.toLowerCase()).not.toContain('level')
    const withHint = rulePhrases({ ...CTX, wordsAtLevelRecentAccuracy: [0.96, 0.97, 1, 0.95, 0.99] })
    expect(withHint.parent.note.toLowerCase()).toContain('level')
  })

  it('handles a noReading take with zero attempted words without crashing or inventing numbers', () => {
    const r = rulePhrases({ ...CTX, score: score({ outcome: 'noReading', attempted: 0, read: 0, stumbled: 0, different: 0, skipped: 0, accuracy: 0, coverage: 0, wcpm: 0, trickyWords: [] }) })
    expect(r.situation).toBe('noReading')
    expect(r.parent.note.length).toBeGreaterThan(0)
  })
})
