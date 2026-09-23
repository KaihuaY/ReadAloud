import { describe, expect, it } from 'vitest'
import { normalizeWord, splitSentences, tokenizeWords, wordCount } from '../textSplit'

describe('normalizeWord', () => {
  it('lowercases and strips leading/trailing punctuation', () => {
    expect(normalizeWord('Cat.')).toBe('cat')
    expect(normalizeWord('"Hat"')).toBe('hat')
    expect(normalizeWord('(mud)')).toBe('mud')
    expect(normalizeWord('Wow!')).toBe('wow')
    expect(normalizeWord('Really?')).toBe('really')
  })

  it('keeps inner apostrophes and hyphens', () => {
    expect(normalizeWord("don't")).toBe("don't")
    expect(normalizeWord('sun-hat')).toBe('sun-hat')
    expect(normalizeWord("'don't.'")).toBe("don't")
  })

  it('returns empty string for pure punctuation', () => {
    expect(normalizeWord('...')).toBe('')
    expect(normalizeWord('--')).toBe('')
    expect(normalizeWord('!')).toBe('')
  })
})

describe('splitSentences', () => {
  it('splits on periods, keeping the mark', () => {
    expect(splitSentences('The cat sat. The dog ran.')).toEqual(['The cat sat.', 'The dog ran.'])
  })

  it('splits on ! and ?', () => {
    expect(splitSentences('Look out! Is it a cat?')).toEqual(['Look out!', 'Is it a cat?'])
  })

  it('treats newlines as sentence breaks too', () => {
    expect(splitSentences('The cat sat\nThe dog ran.')).toEqual(['The cat sat', 'The dog ran.'])
  })

  it('trims whitespace and drops empty sentences', () => {
    expect(splitSentences('  The cat sat.   \n\n  The dog ran.  ')).toEqual([
      'The cat sat.',
      'The dog ran.',
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(splitSentences('')).toEqual([])
  })
})

describe('tokenizeWords', () => {
  it('splits on whitespace with correct char offsets into the original text', () => {
    const text = 'The cat sat.'
    const tokens = tokenizeWords(text)
    expect(tokens.map((t) => t.display)).toEqual(['The', 'cat', 'sat.'])
    for (const t of tokens) {
      expect(text.slice(t.start, t.end)).toBe(t.display)
    }
  })

  it('strips punctuation and quotes for norm but keeps display as-is', () => {
    const tokens = tokenizeWords('"Hi," said the cat.')
    const norms = tokens.map((t) => t.norm)
    expect(norms).toEqual(['hi', 'said', 'the', 'cat'])
  })

  it('keeps inner apostrophes in norm', () => {
    const tokens = tokenizeWords("The cat can't sit.")
    expect(tokens.map((t) => t.norm)).toEqual(['the', 'cat', "can't", 'sit'])
  })

  it('skips tokens that are pure punctuation', () => {
    const tokens = tokenizeWords('Wait -- look!')
    expect(tokens.map((t) => t.norm)).toEqual(['wait', 'look'])
  })

  it('increments sentenceIndex per sentence, matching splitSentences boundaries', () => {
    const text = 'The cat sat. The dog ran! Is it fun?'
    const tokens = tokenizeWords(text)
    const sentences = splitSentences(text)
    expect(sentences).toHaveLength(3)
    expect(tokens.filter((t) => t.sentenceIndex === 0).map((t) => t.norm)).toEqual([
      'the',
      'cat',
      'sat',
    ])
    expect(tokens.filter((t) => t.sentenceIndex === 1).map((t) => t.norm)).toEqual([
      'the',
      'dog',
      'ran',
    ])
    expect(tokens.filter((t) => t.sentenceIndex === 2).map((t) => t.norm)).toEqual([
      'is',
      'it',
      'fun',
    ])
  })

  it('increments sentenceIndex across newline breaks', () => {
    const text = 'The cat sat\nThe dog ran.'
    const tokens = tokenizeWords(text)
    expect(tokens.filter((t) => t.sentenceIndex === 0).map((t) => t.norm)).toEqual([
      'the',
      'cat',
      'sat',
    ])
    expect(tokens.filter((t) => t.sentenceIndex === 1).map((t) => t.norm)).toEqual([
      'the',
      'dog',
      'ran',
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(tokenizeWords('')).toEqual([])
  })
})

describe('wordCount', () => {
  it('counts real words, ignoring pure punctuation', () => {
    expect(wordCount('The cat sat. Wow!')).toBe(4)
  })

  it('returns 0 for empty input', () => {
    expect(wordCount('')).toBe(0)
  })
})
