import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultDoc,
  emptyReading,
  exportJson,
  getDoc,
  importJson,
  mergeDocs,
  resetAll,
  update,
  type ProgressDoc,
} from '../progress'

// A tiny in-memory localStorage mock, since this module persists to
// localStorage and we want deterministic behavior regardless of whether the
// test environment provides a real one (jsdom) or none at all (node).
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

describe('defaultDoc', () => {
  it('has the expected default settings', () => {
    const doc = defaultDoc()
    expect(doc.settings.kidName).toBe('Reader')
    expect(doc.settings.parentName).toBe('')
    expect(doc.settings.pin).toBe('1234')
    expect(doc.settings.readingLevel).toBe(1)
    expect(doc.settings.readsPerDay).toBe(3)
    expect(doc.settings.maxRecordSeconds).toBe(60)
    expect(doc.settings.listenFirst).toBe(true)
    expect(doc.settings.customPassages).toEqual([])
    expect(doc.settings.recordingKeepDays).toBe(14)
    expect(doc.profile).toEqual({ xp: 0, tokens: { gold: 0, silver: 0, bronze: 0 }, updatedAt: doc.profile.updatedAt })
    expect(doc.reading).toEqual({ takes: [], days: {}, streak: { current: 0, best: 0, lastDay: '' }, passageBests: {}, practice: {}, updatedAt: doc.reading.updatedAt })
  })

  it('has no fixed-dollar cash prizes', () => {
    const doc = defaultDoc()
    const allPrizes = [...doc.settings.prizePools.gold, ...doc.settings.prizePools.silver, ...doc.settings.prizePools.bronze]
    expect(allPrizes.some((p) => /^\$\d+$/.test(p.name))).toBe(false)
    const gold = doc.settings.prizePools.gold.find((p) => p.id === 'gold-cash')
    expect(gold).toEqual({ id: 'gold-cash', name: 'Cash surprise', emoji: '💵', weight: 1, kind: 'cash', minCents: 25, maxCents: 100 })
  })
})

describe('normalizeDoc (via importJson) - a doc missing `reading`', () => {
  it('backfills an empty reading section rather than leaving it undefined', () => {
    const legacyJson = JSON.stringify({
      schemaVersion: 1,
      settings: { updatedAt: 1 },
      profile: { updatedAt: 1 },
      rewards: { updatedAt: 1 },
      notes: { updatedAt: 1 },
      collection: { updatedAt: 1 },
    })

    importJson(legacyJson)
    const doc = getDoc()

    expect(doc.reading).toEqual(emptyReading(0))
  })

  it('preserves reading takes/streak already present while backfilling missing nested fields', () => {
    const legacyJson = JSON.stringify({
      schemaVersion: 1,
      settings: { updatedAt: 1 },
      profile: { updatedAt: 1 },
      rewards: { updatedAt: 1 },
      reading: { takes: [{ id: 't1' }], updatedAt: 5 },
      notes: { updatedAt: 1 },
      collection: { updatedAt: 1 },
    })

    importJson(legacyJson)
    const doc = getDoc()

    expect(doc.reading.takes).toEqual([{ id: 't1' }])
    expect(doc.reading.days).toEqual({})
    expect(doc.reading.streak).toEqual({ current: 0, best: 0, lastDay: '' })
    expect(doc.reading.passageBests).toEqual({})
    expect(doc.reading.practice).toEqual({})
  })
})

describe('mergeDocs', () => {
  it('picks the newer section from each side independently, dropping nothing, including unknown sections', () => {
    const local: ProgressDoc = defaultDoc()
    local.settings.updatedAt = 100
    local.settings.kidName = 'Local Kid'
    local.reading.updatedAt = 300 // local wins here
    local.reading.streak.current = 5
    local.notes.updatedAt = 100

    const remote: ProgressDoc = defaultDoc()
    remote.settings.updatedAt = 200 // remote wins here
    remote.settings.kidName = 'Remote Kid'
    remote.reading.updatedAt = 150
    remote.reading.streak.current = 99
    remote.notes.updatedAt = 100 // tie -> local kept

    const merged = mergeDocs(local, remote)

    expect(merged.settings.kidName).toBe('Remote Kid')
    expect(merged.reading.streak.current).toBe(5)
    expect(merged.notes).toEqual(local.notes)
    expect(merged.collection).toEqual(local.collection)
  })

  it('mergeUnknownSections carries a top-level key neither side recognizes', () => {
    const local = defaultDoc() as unknown as Record<string, unknown>
    local.futureSection = { updatedAt: 1, value: 'local-only' }
    const remote = defaultDoc()

    const merged = mergeDocs(local as unknown as ProgressDoc, remote) as unknown as Record<string, unknown>
    expect(merged.futureSection).toEqual({ updatedAt: 1, value: 'local-only' })
  })

  it('a remote doc missing `reading` outright (an old build) never crashes and keeps local', () => {
    const local = defaultDoc()
    local.reading.updatedAt = 500
    local.reading.streak.current = 3
    const rawRemote: Record<string, unknown> = { ...defaultDoc() }
    delete rawRemote.reading
    const remote = rawRemote as unknown as ProgressDoc
    expect(() => mergeDocs(local, remote)).not.toThrow()
    expect(mergeDocs(local, remote).reading).toEqual(local.reading)
  })
})

describe('export / import round trip', () => {
  it('restores an identical doc after export then import', () => {
    update('settings', (s) => ({ ...s, kidName: 'Reader the Great', readingLevel: 3 }))
    update('reading', (r) => ({ ...r, streak: { current: 2, best: 2, lastDay: '2026-09-07' } }))

    const before = getDoc()
    const json = exportJson()

    resetAll()
    expect(getDoc()).not.toEqual(before)

    importJson(json)
    expect(getDoc()).toEqual(before)
  })

  it('rejects a file with the wrong schema version', () => {
    expect(() => importJson(JSON.stringify({ schemaVersion: 2 }))).toThrow()
  })
})

describe('a brand-new (never-edited) local doc never outranks synced data', () => {
  it('stamps every section updatedAt: 0 so mergeDocs always prefers real remote progress', async () => {
    vi.resetModules()
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(), // empty - nothing saved on this "device" yet
      configurable: true,
      writable: true,
    })

    const fresh = await import('../progress')
    const localDoc = fresh.getDoc()
    expect(localDoc.settings.updatedAt).toBe(0)
    expect(localDoc.profile.updatedAt).toBe(0)
    expect(localDoc.reading.updatedAt).toBe(0)

    const remote = fresh.defaultDoc()
    remote.profile.updatedAt = 12345
    remote.profile.xp = 77
    remote.settings.updatedAt = 12345
    remote.settings.kidName = 'Synced Kid'

    const merged = fresh.mergeDocs(localDoc, remote)
    expect(merged.profile.xp).toBe(77)
    expect(merged.settings.kidName).toBe('Synced Kid')
  })
})

describe('resetAll', () => {
  it('stamps every section with updatedAt 0 so a reset never beats real progress in a merge', () => {
    resetAll()
    const local = getDoc()
    expect(local.profile.updatedAt).toBe(0)
    expect(local.reading.updatedAt).toBe(0)
    const remote = defaultDoc()
    remote.profile.updatedAt = 1
    remote.profile.xp = 300
    const merged = mergeDocs(local, remote)
    expect(merged.profile.xp).toBe(300)
  })
})

describe('automatic migration backups', () => {
  it('writes a backup and records the build id when the stored doc needs shape migration', async () => {
    vi.resetModules()
    const storage = new MemoryStorage()
    const legacyRaw = JSON.stringify({
      schemaVersion: 1,
      settings: { updatedAt: 1 },
      profile: { updatedAt: 1 },
      rewards: { updatedAt: 1 },
      notes: { updatedAt: 1 },
      collection: { updatedAt: 1 },
    })
    storage.setItem('readaloud.progress', legacyRaw)
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })

    const fresh = await import('../progress')
    const backups = fresh.listBackups()
    expect(backups.length).toBe(1)
    expect(backups[0].buildId).toBe('test-build')
    expect(storage.getItem('readaloud.buildId')).toBe('test-build')
  })

  it('keeps only the last 3 automatic backups', async () => {
    vi.resetModules()
    const storage = new MemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
    let fresh = await import('../progress')

    for (let i = 0; i < 4; i++) {
      fresh.update('settings', (s) => ({ ...s, kidName: `Name ${i}` }))
      storage.removeItem('readaloud.buildId') // force a backup on the next reload
      vi.resetModules()
      fresh = await import('../progress')
    }

    expect(fresh.listBackups().length).toBe(3)
  })
})

describe('restoreBackup', () => {
  it('round-trips the backup content and pushes a reversal backup so restoring is itself reversible', async () => {
    vi.resetModules()
    const storage = new MemoryStorage()
    const legacyRaw = JSON.stringify({
      schemaVersion: 1,
      settings: { updatedAt: 1, kidName: 'Old Name' },
      profile: { updatedAt: 1 },
      rewards: { updatedAt: 1 },
      notes: { updatedAt: 1 },
      collection: { updatedAt: 1 },
    })
    storage.setItem('readaloud.progress', legacyRaw)
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })

    const fresh = await import('../progress')
    expect(fresh.listBackups().length).toBe(1)

    fresh.update('settings', (s) => ({ ...s, kidName: 'New Name' }))
    expect(fresh.getDoc().settings.kidName).toBe('New Name')

    fresh.restoreBackup(0)
    expect(fresh.getDoc().settings.kidName).toBe('Old Name')
    expect(fresh.listBackups().length).toBe(2)
  })

  it('throws for an out-of-range index rather than silently doing nothing', async () => {
    vi.resetModules()
    const storage = new MemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
    const fresh = await import('../progress')
    expect(() => fresh.restoreBackup(0)).toThrow()
  })
})

describe('storage keys', () => {
  it('persists under readaloud.progress', () => {
    update('settings', (s) => ({ ...s, kidName: 'Persisted' }))
    expect(JSON.parse(localStorage.getItem('readaloud.progress')!).settings.kidName).toBe('Persisted')
  })
})
