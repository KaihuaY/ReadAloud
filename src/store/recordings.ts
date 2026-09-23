// Raw IndexedDB blob store for reading takes recorded on this device. Deals
// in ArrayBuffer (not Blob) inside the database, since IndexedDB's Blob
// support is inconsistent across old Safari versions - the API surface
// still speaks Blob so callers never notice.
//
// This is the local copy only: it never leaves the device except through
// the Google Drive upload (src/store/driveUpload.ts) or the iOS share
// sheet. Metadata about takes (not the audio) lives in the synced
// ProgressDoc's `reading` section.

import { useSyncExternalStore } from 'react'

export interface RecordingMeta {
  id: string
  savedAt: number
  sizeBytes: number
  mimeType: string
}

/**
 * One ~1s chunk of an in-progress take, written as it's recorded (see
 * recordingSession.ts) so a crash or reload never loses more than the last
 * second or so of audio. `id` is the take id it belongs to (assigned before
 * recording starts, so it matches the take's own id once saved).
 */
export interface PartialChunk {
  id: string
  seq: number
  bytes: ArrayBuffer
  mimeType: string
  startedAt: number
  passageId: string
  deviceId: string
}

export interface AssembledPartial {
  blob: Blob
  mimeType: string
  startedAt: number
  passageId: string
  /** Number of chunks assembled - roughly the recording's duration in seconds (see recordingSession.ts's ~1s chunk cadence). */
  chunks: number
}

export interface RecordingStore {
  put(id: string, blob: Blob, savedAt?: number): Promise<RecordingMeta>
  get(id: string): Promise<Blob | null>
  remove(id: string): Promise<void>
  list(): Promise<RecordingMeta[]>
  usageBytes(): Promise<number>
  /** Removes every recording saved strictly before cutoffMs. Returns the removed ids. */
  pruneOlderThan(cutoffMs: number): Promise<string[]>
  clear(): Promise<void>
  /** Writes (or overwrites, if the same id+seq is written twice) one chunk of an in-progress take. */
  putPartial(rec: PartialChunk): Promise<void>
  /** Every take id with at least one partial chunk still stored. */
  listPartialIds(): Promise<string[]>
  /** Concatenates every chunk for `id` (ordered by seq) into one blob, or null if there are none. */
  assemblePartial(id: string): Promise<AssembledPartial | null>
  /** Removes every partial chunk for `id`. Safe to call when there are none. */
  deletePartial(id: string): Promise<void>
}

export const RECORDINGS_DB = 'readaloud.recordings'

const STORE_NAME = 'takes'
const PARTIALS_STORE = 'partials'
const DB_VERSION = 2

interface StoredRecord {
  id: string
  savedAt: number
  sizeBytes: number
  mimeType: string
  bytes: ArrayBuffer
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

class IndexedDbRecordingStore implements RecordingStore {
  private readonly factory: IDBFactory
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(factory: IDBFactory) {
    this.factory = factory
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.factory.open(RECORDINGS_DB, DB_VERSION)
        // Only ever creates whatever store is missing - a v1 database
        // upgrading to v2 keeps its existing `takes` untouched and just
        // gains `partials`; this callback also runs (harmlessly, both
        // conditions already true) on a fresh v1 -> v2 database.
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
            store.createIndex('savedAt', 'savedAt')
          }
          if (!db.objectStoreNames.contains(PARTIALS_STORE)) {
            const store = db.createObjectStore(PARTIALS_STORE, { keyPath: ['id', 'seq'] })
            store.createIndex('id', 'id')
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    return this.dbPromise
  }

  async put(id: string, blob: Blob, savedAt: number = Date.now()): Promise<RecordingMeta> {
    const db = await this.openDb()
    const bytes = await blob.arrayBuffer()
    const record: StoredRecord = { id, savedAt, sizeBytes: bytes.byteLength, mimeType: blob.type, bytes }
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    await promisifyTx(tx)
    return { id, savedAt, sizeBytes: record.sizeBytes, mimeType: record.mimeType }
  }

  async get(id: string): Promise<Blob | null> {
    try {
      const db = await this.openDb()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const record = await promisifyRequest<StoredRecord | undefined>(tx.objectStore(STORE_NAME).get(id))
      if (!record) return null
      return new Blob([record.bytes], { type: record.mimeType })
    } catch {
      return null
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    await promisifyTx(tx)
  }

  async list(): Promise<RecordingMeta[]> {
    const db = await this.openDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const records = await promisifyRequest<StoredRecord[]>(tx.objectStore(STORE_NAME).getAll())
    return records
      .map((r) => ({ id: r.id, savedAt: r.savedAt, sizeBytes: r.sizeBytes, mimeType: r.mimeType }))
      .sort((a, b) => a.savedAt - b.savedAt)
  }

  async usageBytes(): Promise<number> {
    const items = await this.list()
    return items.reduce((sum, item) => sum + item.sizeBytes, 0)
  }

  async pruneOlderThan(cutoffMs: number): Promise<string[]> {
    const items = await this.list()
    const staleIds = items.filter((item) => item.savedAt < cutoffMs).map((item) => item.id)
    if (staleIds.length === 0) return []
    const db = await this.openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const id of staleIds) store.delete(id)
    await promisifyTx(tx)
    return staleIds
  }

  async clear(): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    await promisifyTx(tx)
  }

  async putPartial(rec: PartialChunk): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction(PARTIALS_STORE, 'readwrite')
    tx.objectStore(PARTIALS_STORE).put(rec)
    await promisifyTx(tx)
  }

  async listPartialIds(): Promise<string[]> {
    const db = await this.openDb()
    const tx = db.transaction(PARTIALS_STORE, 'readonly')
    const all = await promisifyRequest<PartialChunk[]>(tx.objectStore(PARTIALS_STORE).getAll())
    return Array.from(new Set(all.map((r) => r.id)))
  }

  async assemblePartial(id: string): Promise<AssembledPartial | null> {
    const db = await this.openDb()
    const tx = db.transaction(PARTIALS_STORE, 'readonly')
    const records = await promisifyRequest<PartialChunk[]>(tx.objectStore(PARTIALS_STORE).index('id').getAll(id))
    if (records.length === 0) return null
    records.sort((a, b) => a.seq - b.seq)
    const mimeType = records[0].mimeType
    const blob = new Blob(
      records.map((r) => r.bytes),
      { type: mimeType },
    )
    return { blob, mimeType, startedAt: records[0].startedAt, passageId: records[0].passageId, chunks: records.length }
  }

  async deletePartial(id: string): Promise<void> {
    const db = await this.openDb()
    const readTx = db.transaction(PARTIALS_STORE, 'readonly')
    const keys = await promisifyRequest<IDBValidKey[]>(readTx.objectStore(PARTIALS_STORE).index('id').getAllKeys(id))
    if (keys.length === 0) return
    const writeTx = db.transaction(PARTIALS_STORE, 'readwrite')
    const store = writeTx.objectStore(PARTIALS_STORE)
    for (const key of keys) store.delete(key)
    await promisifyTx(writeTx)
  }
}

/** A store that quietly does nothing, for platforms without IndexedDB. */
function createNoopRecordingStore(): RecordingStore {
  return {
    async put(id: string, blob: Blob, savedAt: number = Date.now()): Promise<RecordingMeta> {
      return { id, savedAt, sizeBytes: blob.size, mimeType: blob.type }
    },
    async get(_id: string): Promise<Blob | null> {
      return null
    },
    async remove(_id: string): Promise<void> {},
    async list(): Promise<RecordingMeta[]> {
      return []
    },
    async usageBytes(): Promise<number> {
      return 0
    },
    async pruneOlderThan(_cutoffMs: number): Promise<string[]> {
      return []
    },
    async clear(): Promise<void> {},
    async putPartial(_rec: PartialChunk): Promise<void> {},
    async listPartialIds(): Promise<string[]> {
      return []
    },
    async assemblePartial(_id: string): Promise<AssembledPartial | null> {
      return null
    },
    async deletePartial(_id: string): Promise<void> {},
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

export function openRecordingStore(factory?: IDBFactory): RecordingStore {
  const resolvedFactory = factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined)
  if (!resolvedFactory) {
    throw new Error('IndexedDB is not available')
  }
  return new IndexedDbRecordingStore(resolvedFactory)
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

// --- Default instance + a subscribe-able set of locally-present ids -------
//
// Screens want to know "does this take still have its audio on THIS
// device" without threading a store instance through every component, and
// want to re-render when that changes (a take is recorded, pruned, or
// deleted). Mirrors the useSyncExternalStore pattern in recordingSession.ts.

let localAudioIds: ReadonlySet<string> = new Set()
const idListeners = new Set<() => void>()

function getLocalAudioIdsSnapshot(): ReadonlySet<string> {
  return localAudioIds
}

function subscribeLocalAudioIds(cb: () => void): () => void {
  idListeners.add(cb)
  return () => idListeners.delete(cb)
}

async function refreshLocalAudioIds(store: RecordingStore): Promise<void> {
  let ids: ReadonlySet<string>
  try {
    const items = await store.list()
    ids = new Set(items.map((item) => item.id))
  } catch {
    ids = new Set()
  }
  localAudioIds = ids
  for (const listener of idListeners) listener()
}

function wrapWithIdTracking(store: RecordingStore): RecordingStore {
  return {
    async put(id, blob, savedAt) {
      const meta = await store.put(id, blob, savedAt)
      await refreshLocalAudioIds(store)
      return meta
    },
    get(id) {
      return store.get(id)
    },
    async remove(id) {
      await store.remove(id)
      await refreshLocalAudioIds(store)
    },
    list() {
      return store.list()
    },
    usageBytes() {
      return store.usageBytes()
    },
    async pruneOlderThan(cutoffMs) {
      const removed = await store.pruneOlderThan(cutoffMs)
      await refreshLocalAudioIds(store)
      return removed
    },
    async clear() {
      await store.clear()
      await refreshLocalAudioIds(store)
    },
    // Partials never affect the "does this take have local audio" tracking
    // above (a partial isn't a take yet) - passed straight through.
    putPartial(rec) {
      return store.putPartial(rec)
    },
    listPartialIds() {
      return store.listPartialIds()
    },
    assemblePartial(id) {
      return store.assemblePartial(id)
    },
    deletePartial(id) {
      return store.deletePartial(id)
    },
  }
}

let defaultStore: RecordingStore | null = null

export function getRecordingStore(): RecordingStore {
  if (!defaultStore) {
    const raw = isIndexedDbAvailable() ? openRecordingStore() : createNoopRecordingStore()
    defaultStore = wrapWithIdTracking(raw)
    void refreshLocalAudioIds(raw)
  }
  return defaultStore
}

export function useLocalAudioIds(): ReadonlySet<string> {
  getRecordingStore() // ensure the default store (and its id tracking) exists
  return useSyncExternalStore(subscribeLocalAudioIds, getLocalAudioIdsSnapshot, getLocalAudioIdsSnapshot)
}

/**
 * Asks the browser to protect this origin's storage from the "clear the
 * oldest site data under pressure" eviction some browsers do after ~7 days
 * of not being visited. Best-effort: some browsers grant it silently for an
 * installed/bookmarked PWA, some ask the user, some (notably desktop Safari)
 * don't implement it at all - `false` just means "couldn't confirm it's
 * protected," never an error. Safe to call from anywhere, including node
 * (tests, SSR) and outside a user gesture (though a gesture helps on
 * browsers that condition the grant on one).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false
    const persist = navigator.storage?.persist
    if (typeof persist !== 'function') return false
    return await persist.call(navigator.storage)
  } catch {
    return false
  }
}
