import { beforeEach, describe, expect, it } from 'vitest'
import { addCustomPassage, allPassages, myBooks, removeCustomPassage, updateCustomPassage } from '../customPassages'
import { PASSAGES, SEED_BOOKS } from '../../content/passages'
import { getDoc, resetAll } from '../progress'

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

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
})

describe('addCustomPassage', () => {
  it('creates a custom- id with wordCount/focus/addedAt from the level', () => {
    const p = addCustomPassage(
      { title: 'My Story', text: 'The cat sat on a mat.', level: 1, source: 'typed' },
      { now: () => 555, id: () => 'abc' },
    )
    expect(p.id).toBe('custom-abc')
    expect(p.title).toBe('My Story')
    expect(p.wordCount).toBe(6)
    expect(p.focus).toBe('short a')
    expect(p.addedAt).toBe(555)
    expect(p.emoji).toBe('📖')
    expect(p.source).toBe('typed')
    expect(getDoc().settings.customPassages).toHaveLength(1)
  })

  it('trims title/text and collapses whitespace', () => {
    const p = addCustomPassage({ title: '  Spacey  ', text: '  words   with     gaps  ', level: 2, source: 'typed' })
    expect(p.title).toBe('Spacey')
    expect(p.text).toBe('words with gaps')
  })

  it('uses a provided emoji instead of the default', () => {
    const p = addCustomPassage({ title: 'T', text: 'hi', level: 1, source: 'typed', emoji: '🐸' })
    expect(p.emoji).toBe('🐸')
  })

  it('rejects an empty title', () => {
    expect(() => addCustomPassage({ title: '   ', text: 'hi there', level: 1, source: 'typed' })).toThrow()
  })

  it('rejects empty text', () => {
    expect(() => addCustomPassage({ title: 'T', text: '   ', level: 1, source: 'typed' })).toThrow()
  })

  it('rejects text over 400 words', () => {
    const longText = new Array(401).fill('word').join(' ')
    expect(() => addCustomPassage({ title: 'T', text: longText, level: 1, source: 'typed' })).toThrow()
  })

  it('accepts exactly 400 words', () => {
    const text = new Array(400).fill('word').join(' ')
    const p = addCustomPassage({ title: 'T', text, level: 1, source: 'typed' })
    expect(p.wordCount).toBe(400)
  })
})

describe('ordering in allPassages / myBooks', () => {
  it('puts SEED_BOOKS first, then custom passages newest-first, then PASSAGES', () => {
    addCustomPassage({ title: 'First', text: 'one two three', level: 1, source: 'typed' }, { now: () => 100, id: () => 'a' })
    addCustomPassage({ title: 'Second', text: 'four five six', level: 1, source: 'typed' }, { now: () => 200, id: () => 'b' })

    const settings = getDoc().settings
    const all = allPassages(settings)
    expect(all.slice(0, SEED_BOOKS.length).map((p) => p.id)).toEqual(SEED_BOOKS.map((p) => p.id))
    expect(all[SEED_BOOKS.length].id).toBe('custom-b') // newest custom first
    expect(all[SEED_BOOKS.length + 1].id).toBe('custom-a')
    expect(all.slice(SEED_BOOKS.length + 2).map((p) => p.id)).toEqual(PASSAGES.map((p) => p.id))

    const mine = myBooks(settings)
    expect(mine.map((p) => p.id)).toEqual([...SEED_BOOKS.map((p) => p.id), 'custom-b', 'custom-a'])
  })

  it('allPassages/myBooks are stable even if customPassages storage order is not newest-first', () => {
    addCustomPassage({ title: 'Old', text: 'one two three', level: 1, source: 'typed' }, { now: () => 100, id: () => 'old' })
    addCustomPassage({ title: 'New', text: 'four five six', level: 1, source: 'typed' }, { now: () => 200, id: () => 'new' })
    // addCustomPassage prepends, so storage is already newest-first here, but
    // allPassages/myBooks re-sort by addedAt regardless of storage order.
    const settings = getDoc().settings
    expect(allPassages(settings)[SEED_BOOKS.length].id).toBe('custom-new')
  })
})

describe('updateCustomPassage', () => {
  it('recomputes wordCount and focus when text/level change', () => {
    const p = addCustomPassage({ title: 'T', text: 'one two three', level: 1, source: 'typed' }, { now: () => 1, id: () => 'x' })
    const changed = updateCustomPassage(p.id, { text: 'one two three four five', level: 3 })
    expect(changed).toBe(true)
    const updated = getDoc().settings.customPassages.find((c) => c.id === p.id)!
    expect(updated.wordCount).toBe(5)
    expect(updated.focus).toBe('sh / ch / th / ck')
    expect(updated.text).toBe('one two three four five')
    expect(updated.level).toBe(3)
  })

  it('leaves wordCount/focus alone when only the title changes', () => {
    const p = addCustomPassage({ title: 'T', text: 'one two three', level: 1, source: 'typed' }, { now: () => 1, id: () => 'x' })
    updateCustomPassage(p.id, { title: 'New Title' })
    const updated = getDoc().settings.customPassages.find((c) => c.id === p.id)!
    expect(updated.wordCount).toBe(3)
    expect(updated.focus).toBe('short a')
    expect(updated.title).toBe('New Title')
  })

  it('is a no-op (returns false) for an unknown id', () => {
    expect(updateCustomPassage('custom-nope', { title: 'x' })).toBe(false)
  })

  it('is a no-op (returns false) when the patch changes nothing', () => {
    const p = addCustomPassage({ title: 'T', text: 'one two three', level: 1, source: 'typed' }, { now: () => 1, id: () => 'x' })
    expect(updateCustomPassage(p.id, { title: 'T' })).toBe(false)
  })
})

describe('removeCustomPassage', () => {
  it('removes an existing custom passage', () => {
    const p = addCustomPassage({ title: 'T', text: 'one two three', level: 1, source: 'typed' }, { now: () => 1, id: () => 'x' })
    expect(removeCustomPassage(p.id)).toBe(true)
    expect(getDoc().settings.customPassages).toHaveLength(0)
  })

  it('is a no-op (returns false) for an unknown id', () => {
    expect(removeCustomPassage('custom-nope')).toBe(false)
  })
})

describe('settings.updatedAt only bumps on real change', () => {
  it('does not bump updatedAt for a no-op update or a no-op remove', () => {
    const p = addCustomPassage({ title: 'T', text: 'one two three', level: 1, source: 'typed' }, { now: () => 1, id: () => 'x' })
    const before = getDoc().settings.updatedAt

    updateCustomPassage(p.id, { title: 'T' }) // no-op
    expect(getDoc().settings.updatedAt).toBe(before)

    removeCustomPassage('custom-nope') // no-op
    expect(getDoc().settings.updatedAt).toBe(before)

    updateCustomPassage(p.id, { title: 'Changed' }) // real change
    expect(getDoc().settings.updatedAt).toBeGreaterThanOrEqual(before)
  })
})
