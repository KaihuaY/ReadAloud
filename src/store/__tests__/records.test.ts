import { beforeEach, describe, expect, it } from 'vitest'
import { getDoc, resetAll, type ReadingTake } from '../progress'
import { saveTake } from '../reading'
import { beatenRecords, computeRecords, updateRecords } from '../records'

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
function take(day: string, extra: Partial<ReadingTake> = {}): ReadingTake {
  n++
  return {
    id: `t${n}`,
    day,
    passageId: 'l1-cat-nap',
    startedAt: Date.parse(day + 'T10:00:00') + n * 60_000,
    durationSec: 30,
    mimeType: 'audio/mp4',
    sizeBytes: 1,
    hasAudio: true,
    deviceId: 'd',
    ...extra,
  }
}

function withSmooth(day: string, smooth: number, passageId = 'l1-cat-nap'): ReadingTake {
  return take(day, {
    passageId,
    score: {
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
      wcpm: smooth,
      smooth,
      trickyWords: [],
      newPassageBest: false,
    },
  })
}

const streak = { current: 3, best: 5, lastDay: '2026-09-20' }

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
  n = 0
})

describe('computeRecords', () => {
  it('finds the busiest reading day, the best streak, the smoothest read, and how many passages have 3 stars', () => {
    const reading = {
      takes: [
        take('2026-09-18'),
        take('2026-09-19'),
        take('2026-09-19'), // 2 reads on the 19th
        withSmooth('2026-09-19', 80, 'p1'),
        withSmooth('2026-09-20', 95, 'p2'), // smoothest
      ],
      streak,
    }
    const r = computeRecords(reading, 123)
    expect(r.mostReadsInDay).toMatchObject({ value: 3, day: '2026-09-19' })
    expect(r.longestStreakDays).toMatchObject({ value: 5 })
    expect(r.smoothestRead?.value).toBe(95)
    expect(r.passagesWithThreeStars?.value).toBe(2) // p1 and p2 each have a 3-star take
  })

  it('a noReading take never counts toward mostReadsInDay', () => {
    const noReading = take('2026-09-18', {
      score: {
        outcome: 'noReading',
        stars: 0,
        attempted: 0,
        read: 0,
        stumbled: 0,
        different: 0,
        skipped: 5,
        accuracy: 0,
        cleanAccuracy: 0,
        coverage: 0,
        wcpm: 0,
        trickyWords: [],
        newPassageBest: false,
      },
    })
    const reading = { takes: [noReading], streak }
    expect(computeRecords(reading).mostReadsInDay).toBeUndefined()
  })

  it('reports which records were beaten, and nothing on the very first computation', () => {
    const before = computeRecords({ takes: [take('2026-09-18')], streak })
    const after = computeRecords({ takes: [take('2026-09-18'), take('2026-09-19'), take('2026-09-19')], streak })
    expect(beatenRecords(before, after)).toEqual(['mostReadsInDay'])
    expect(beatenRecords(undefined, after)).toEqual([])
  })
})

describe('updateRecords', () => {
  it('caches silently the first time, then celebrates only real improvements and keeps old setAt dates', () => {
    saveTake(take('2026-09-18'))
    expect(updateRecords()).toEqual([])
    const first = getDoc().reading.records!
    expect(first.mostReadsInDay?.value).toBe(1)

    saveTake(take('2026-09-19'))
    saveTake(take('2026-09-19'))
    expect(updateRecords()).toEqual(['mostReadsInDay'])
    expect(getDoc().reading.records!.mostReadsInDay?.value).toBe(2)
  })

  it('writes nothing when no record changed', () => {
    saveTake(take('2026-09-18'))
    updateRecords()
    const before = getDoc().reading.updatedAt
    expect(updateRecords()).toEqual([])
    expect(getDoc().reading.updatedAt).toBe(before)
  })
})
