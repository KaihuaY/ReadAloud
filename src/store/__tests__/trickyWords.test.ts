import { beforeEach, describe, expect, it } from 'vitest'
import { activeTricky, aggregateTricky, recordPractice } from '../trickyWords'
import { getDoc, resetAll, update, type ReadingSection, type ReadingTake, type TakeScore } from '../progress'
import { dayOffset } from '../sessions'

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

const TODAY = '2026-09-22'

function scoreWithTricky(trickyWords: string[]): TakeScore {
  return {
    outcome: 'full',
    stars: 2,
    attempted: 5,
    read: 3,
    stumbled: 2,
    different: 0,
    skipped: 0,
    accuracy: 1,
    cleanAccuracy: 0.6,
    coverage: 1,
    wcpm: 40,
    trickyWords,
    newPassageBest: false,
  }
}

let n = 0
function addTake(day: string, trickyWords: string[]): void {
  n++
  const take: ReadingTake = {
    id: `t${n}`,
    day,
    passageId: 'l1-cat-nap',
    startedAt: Date.parse(`${day}T10:00:00`) + n,
    durationSec: 30,
    mimeType: 'audio/mp4',
    sizeBytes: 1,
    hasAudio: true,
    deviceId: 'd',
    score: scoreWithTricky(trickyWords),
  }
  update('reading', (reading) => ({ ...reading, takes: [...reading.takes, take] }))
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
  n = 0
})

describe('aggregateTricky', () => {
  it('ignores takes older than the window', () => {
    addTake(dayOffset(TODAY, -20), ['ship'])
    addTake(dayOffset(TODAY, -1), ['boat'])
    const entries = aggregateTricky(getDoc().reading, TODAY)
    expect(entries.map((e) => e.word)).toEqual(['boat'])
  })

  it('includes a take exactly at the window edge', () => {
    addTake(dayOffset(TODAY, -13), ['ship']) // 14-day window: today - 13 .. today
    const entries = aggregateTricky(getDoc().reading, TODAY, 14)
    expect(entries.map((e) => e.word)).toEqual(['ship'])
  })

  it('excludes a take one day past the window edge', () => {
    addTake(dayOffset(TODAY, -14), ['ship'])
    const entries = aggregateTricky(getDoc().reading, TODAY, 14)
    expect(entries).toHaveLength(0)
  })

  it('counts occurrences and sorts by count desc, then most recent first', () => {
    addTake(dayOffset(TODAY, -5), ['ship', 'boat'])
    addTake(dayOffset(TODAY, -3), ['ship'])
    addTake(dayOffset(TODAY, -1), ['boat'])
    const entries = aggregateTricky(getDoc().reading, TODAY)
    // ship: count 2, last seen -3; boat: count 2, last seen -1 -> boat first (more recent), same count
    expect(entries.map((e) => e.word)).toEqual(['boat', 'ship'])
    expect(entries.every((e) => e.count === 2)).toBe(true)
  })

  it('normalizes so "Ship!" and "ship" merge into one entry', () => {
    addTake(dayOffset(TODAY, -2), ['Ship!'])
    addTake(dayOffset(TODAY, -1), ['ship'])
    const entries = aggregateTricky(getDoc().reading, TODAY)
    expect(entries).toHaveLength(1)
    expect(entries[0].count).toBe(2)
  })

  it('merges in reading.practice tries/ok and marks retired at ok >= 3', () => {
    addTake(dayOffset(TODAY, -1), ['ship'])
    update('reading', (reading) => ({ ...reading, practice: { ...reading.practice, ship: { tries: 4, ok: 3, lastAt: 1 } } }))
    const entries = aggregateTricky(getDoc().reading, TODAY)
    expect(entries[0].tries).toBe(4)
    expect(entries[0].ok).toBe(3)
    expect(entries[0].retired).toBe(true)
  })

  it('leaves a word with fewer than 3 ok practices as not retired', () => {
    addTake(dayOffset(TODAY, -1), ['ship'])
    update('reading', (reading) => ({ ...reading, practice: { ...reading.practice, ship: { tries: 2, ok: 2, lastAt: 1 } } }))
    const entries = aggregateTricky(getDoc().reading, TODAY)
    expect(entries[0].retired).toBe(false)
  })
})

describe('activeTricky', () => {
  it('excludes retired words and caps to max', () => {
    addTake(dayOffset(TODAY, -1), ['ship', 'boat', 'car', 'bus', 'train', 'plane'])
    update('reading', (reading) => ({ ...reading, practice: { ...reading.practice, ship: { tries: 3, ok: 3, lastAt: 1 } } }))
    const entries = activeTricky(getDoc().reading, TODAY, 3)
    expect(entries.some((e) => e.word === 'ship')).toBe(false)
    expect(entries.length).toBeLessThanOrEqual(3)
  })
})

describe('recordPractice', () => {
  it('increments tries, increments ok only when successful, and bumps reading.updatedAt', () => {
    const before = getDoc().reading.updatedAt
    recordPractice('Ship!', true, { now: () => 100 })
    let reading: ReadingSection = getDoc().reading
    expect(reading.practice.ship).toEqual({ tries: 1, ok: 1, lastAt: 100 })
    expect(reading.updatedAt).toBeGreaterThanOrEqual(before)

    recordPractice('ship', false, { now: () => 200 })
    reading = getDoc().reading
    expect(reading.practice.ship).toEqual({ tries: 2, ok: 1, lastAt: 200 })
  })

  it('is a no-op for a word that normalizes to empty', () => {
    const before = getDoc().reading.updatedAt
    recordPractice('!!!', true)
    expect(getDoc().reading.updatedAt).toBe(before)
    expect(Object.keys(getDoc().reading.practice)).toHaveLength(0)
  })
})
