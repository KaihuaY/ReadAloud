import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addNote, markNoteSeen, unseenNotes } from '../notes'
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
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
  resetAll()
})

describe('addNote', () => {
  it('stamps id/createdAt and defaults day to today (local)', () => {
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0, 0)) // 2026-09-09 local noon
    const note = addNote({ about: 'general', text: 'Great job today!' })

    expect(note.id).toBeTruthy()
    expect(note.day).toBe('2026-09-09')
    expect(note.createdAt).toBeGreaterThan(0)
    expect(note.text).toBe('Great job today!')
    expect(note.seenAt).toBeUndefined()
    expect(getDoc().notes.items).toEqual([note])
    vi.useRealTimers()
  })

  it('accepts an explicit day and an audioTakeId, for a note tied to a past day/recording', () => {
    const note = addNote({ about: 'reading', day: '2026-09-05', audioTakeId: 'take-123' })
    expect(note.day).toBe('2026-09-05')
    expect(note.audioTakeId).toBe('take-123')
    expect(note.about).toBe('reading')
  })
})

describe('markNoteSeen', () => {
  it('stamps seenAt on exactly the given note, leaving others untouched', () => {
    const a = addNote({ about: 'general', text: 'first' })
    const b = addNote({ about: 'general', text: 'second' })

    markNoteSeen(a.id)

    const items = getDoc().notes.items
    expect(items.find((n) => n.id === a.id)?.seenAt).toBeGreaterThan(0)
    expect(items.find((n) => n.id === b.id)?.seenAt).toBeUndefined()
  })

  it('is a safe no-op for an id that does not exist', () => {
    addNote({ about: 'general', text: 'first' })
    expect(() => markNoteSeen('does-not-exist')).not.toThrow()
    expect(getDoc().notes.items.every((n) => !n.seenAt)).toBe(true)
  })
})

describe('unseenNotes', () => {
  it('excludes seen notes and orders the rest newest first', () => {
    vi.setSystemTime(1000)
    const oldest = addNote({ about: 'general', text: 'oldest' })
    vi.setSystemTime(2000)
    const middle = addNote({ about: 'general', text: 'middle' })
    vi.setSystemTime(3000)
    const newest = addNote({ about: 'general', text: 'newest' })

    markNoteSeen(middle.id)

    expect(unseenNotes(getDoc()).map((n) => n.id)).toEqual([newest.id, oldest.id])
    vi.useRealTimers()
  })

  it('returns an empty array when there are no notes at all', () => {
    expect(unseenNotes(getDoc())).toEqual([])
  })
})
