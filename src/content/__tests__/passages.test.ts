import { describe, expect, it } from 'vitest'
import {
  LEVEL_WORDS,
  LEVELS,
  PASSAGES,
  type PassageLevel,
  SEED_BOOKS,
  SIGHT_WORDS,
  SIGHT_WORDS_L8,
  levelInfo,
  passageById,
  passagesForLevel,
} from '../passages'
import { splitSentences, tokenizeWords, wordCount } from '../textSplit'

const ALL_LEVELS: PassageLevel[] = [1, 2, 3, 4, 5, 6, 7, 8]

const SENTENCE_RANGE: Record<PassageLevel, [number, number]> = {
  1: [1, 2],
  2: [1, 2],
  3: [2, 3],
  4: [2, 3],
  5: [3, 3],
  6: [3, 3],
  7: [3, 4],
  8: [3, 4],
}

const WORD_RANGE: Record<PassageLevel, [number, number]> = {
  1: [4, 10],
  2: [6, 14],
  3: [10, 20],
  4: [12, 24],
  5: [15, 28],
  6: [18, 32],
  7: [20, 36],
  8: [24, 45],
}

function allowedWordsUpTo(level: PassageLevel): Set<string> {
  const set = new Set<string>(SIGHT_WORDS.map((w) => w.toLowerCase()))
  for (let lv = 1; lv <= level; lv++) {
    for (const w of LEVEL_WORDS[lv as PassageLevel]) set.add(w.toLowerCase())
  }
  if (level >= 8) {
    for (const w of SIGHT_WORDS_L8) set.add(w.toLowerCase())
  }
  return set
}

describe('SIGHT_WORDS', () => {
  it('is exactly the fixed list', () => {
    expect(SIGHT_WORDS).toEqual(['the', 'a', 'is', 'i', 'to', 'and', 'on', 'in', 'it', 'has', 'can', 'see'])
  })
})

describe('LEVELS', () => {
  it('has an entry for every level with kid-friendly fields', () => {
    for (const level of ALL_LEVELS) {
      const info = levelInfo(level)
      expect(info).toBeDefined()
      expect(info!.name.length).toBeGreaterThan(0)
      expect(info!.focus.length).toBeGreaterThan(0)
      expect(info!.hint.length).toBeGreaterThan(0)
    }
    expect(LEVELS).toHaveLength(8)
  })
})

describe('PASSAGES + SEED_BOOKS', () => {
  it('have unique ids', () => {
    const ids = [...PASSAGES, ...SEED_BOOKS].map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('each has a non-empty emoji and title', () => {
    for (const p of [...PASSAGES, ...SEED_BOOKS]) {
      expect(p.emoji.length).toBeGreaterThan(0)
      expect(p.title.trim().length).toBeGreaterThan(0)
    }
  })

  it('wordCount field matches wordCount(text)', () => {
    for (const p of [...PASSAGES, ...SEED_BOOKS]) {
      expect(p.wordCount).toBe(wordCount(p.text))
    }
  })

  it('has exactly 8 built-in passages per level', () => {
    for (const level of ALL_LEVELS) {
      expect(passagesForLevel(level)).toHaveLength(8)
    }
  })

  it('each sentence ends with . ! or ?', () => {
    for (const p of [...PASSAGES, ...SEED_BOOKS]) {
      for (const sentence of splitSentences(p.text)) {
        expect(sentence).toMatch(/[.!?]$/)
      }
    }
  })

  it('sentence and word counts fall within each level\'s range for built-ins', () => {
    for (const level of ALL_LEVELS) {
      const [minS, maxS] = SENTENCE_RANGE[level]
      const [minW, maxW] = WORD_RANGE[level]
      for (const p of passagesForLevel(level)) {
        const sentences = splitSentences(p.text)
        expect(sentences.length).toBeGreaterThanOrEqual(minS)
        expect(sentences.length).toBeLessThanOrEqual(maxS)
        const words = wordCount(p.text)
        expect(words).toBeGreaterThanOrEqual(minW)
        expect(words).toBeLessThanOrEqual(maxW)
      }
    }
  })

  it('every word of every builtin passage is decodable at or below its level', () => {
    for (const p of PASSAGES) {
      const allowed = allowedWordsUpTo(p.level)
      for (const token of tokenizeWords(p.text)) {
        expect(
          allowed.has(token.norm),
          `word "${token.norm}" in passage "${p.id}" (level ${p.level}) is not in SIGHT_WORDS or LEVEL_WORDS at or below its level`,
        ).toBe(true)
      }
    }
  })

  it('has no word longer than 6 letters at L1-L3', () => {
    for (const level of [1, 2, 3] as PassageLevel[]) {
      for (const p of passagesForLevel(level)) {
        for (const token of tokenizeWords(p.text)) {
          expect(token.norm.replace(/[^a-z]/g, '').length).toBeLessThanOrEqual(6)
        }
      }
    }
  })

  it('passageById finds builtin and seed entries', () => {
    expect(passageById('l1-cat-nap')?.title).toBe('Cat Nap')
    expect(passageById('book-princess-in-black-science-fair')?.source).toBe('book-original')
    expect(passageById('nonexistent-id')).toBeUndefined()
  })

  it('passageById finds entries from the extra list', () => {
    const extra = [
      {
        id: 'custom-1',
        level: 1 as PassageLevel,
        title: 'Custom',
        text: 'A cat sat.',
        emoji: '🐱',
        wordCount: 3,
        focus: 'short a',
        source: 'typed' as const,
      },
    ]
    expect(passageById('custom-1', extra)?.title).toBe('Custom')
  })

  it('SEED_BOOKS has exactly the placeholder book', () => {
    expect(SEED_BOOKS).toHaveLength(1)
    const book = SEED_BOOKS[0]
    expect(book.id).toBe('book-princess-in-black-science-fair')
    expect(book.source).toBe('book-original')
    expect(book.sourceNote).toMatch(/not the book/i)
  })
})
