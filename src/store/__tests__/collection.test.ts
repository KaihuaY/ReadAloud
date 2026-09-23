import { beforeEach, describe, expect, it } from 'vitest'
import { awardItem, ownedItem, useCollection } from '../collection'
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

describe('awardItem', () => {
  it('adds a new item at count 1, not flagged as a duplicate', () => {
    const result = awardItem('quartz', 100)
    expect(result).toEqual({ duplicate: false, count: 1 })
    expect(getDoc().collection.items).toEqual([{ id: 'quartz', count: 1, firstAt: 100 }])
  })

  it('increments the count and flags a duplicate on a second drop of the same id', () => {
    awardItem('quartz', 100)
    const result = awardItem('quartz', 200)
    expect(result).toEqual({ duplicate: true, count: 2 })
    expect(getDoc().collection.items).toEqual([{ id: 'quartz', count: 2, firstAt: 100 }])
  })

  it('keeps different ids independent', () => {
    awardItem('quartz')
    awardItem('fox')
    expect(getDoc().collection.items.map((i) => i.id).sort()).toEqual(['fox', 'quartz'])
  })
})

describe('ownedItem', () => {
  it('finds an owned item by id, undefined for one never dropped', () => {
    awardItem('quartz')
    expect(ownedItem('quartz')?.count).toBe(1)
    expect(ownedItem('never-owned')).toBeUndefined()
  })
})

describe('useCollection', () => {
  it('is a function (the hook itself needs a React render to exercise fully)', () => {
    expect(typeof useCollection).toBe('function')
  })
})
