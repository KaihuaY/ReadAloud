import { beforeEach, describe, expect, it } from 'vitest'
import { awardNewBadges, dismissBadgeToast } from '../badges'
import { getDoc, resetAll, update } from '../progress'

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

describe('awardNewBadges', () => {
  it('appends only newly-earned ids, stamped with earnedAt, and never awards the same badge twice', () => {
    update('reading', (reading) => ({
      ...reading,
      takes: [
        {
          id: 't1',
          day: '2026-09-07',
          passageId: 'p1',
          startedAt: 0,
          durationSec: 60,
          mimeType: 'audio/webm',
          sizeBytes: 1,
          hasAudio: true,
          deviceId: 'd',
        },
      ],
    }))

    const firstRound = awardNewBadges()
    expect(firstRound).toEqual(['first-read'])
    const stored = getDoc().rewards.badges ?? []
    expect(stored.map((b) => b.id)).toEqual(['first-read'])
    expect(stored[0].earnedAt).toBeGreaterThan(0)

    // Calling again with nothing new earned is a no-op - no doc write, no duplicate.
    const beforeUpdatedAt = getDoc().rewards.updatedAt
    expect(awardNewBadges()).toEqual([])
    expect(getDoc().rewards.badges?.length).toBe(1)
    expect(getDoc().rewards.updatedAt).toBe(beforeUpdatedAt)
  })
})

describe('dismissBadgeToast', () => {
  it('is a safe no-op for an id that is not queued', () => {
    expect(() => dismissBadgeToast('not-queued')).not.toThrow()
  })
})
