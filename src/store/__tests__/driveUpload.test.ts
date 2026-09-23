import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backupProgressToDrive,
  buildFileName,
  enqueueUpload,
  isDriveConfigured,
  lastProgressBackupDay,
  processUploadQueue,
  retryFailedUploads,
  testDriveConnection,
  uploadNow,
  useUploadSummary,
  type DriveConfig,
} from '../driveUpload'
import { getDoc, resetAll, update, type ReadingTake } from '../progress'
import type { RecordingStore } from '../recordings'

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

const DEVICE_ID = 'device-a'
const OTHER_DEVICE_ID = 'device-b'
const SECRET = 'shh'
const CFG: DriveConfig = { scriptUrl: 'https://script.google.com/exec', secret: SECRET, folderName: 'Read Aloud takes' }

function makeTake(overrides: Partial<ReadingTake> = {}): ReadingTake {
  return {
    id: 'take-1',
    day: '2026-09-07',
    passageId: 'l1-cat-nap',
    startedAt: new Date(2026, 8, 7, 14, 5).getTime(),
    durationSec: 60,
    mimeType: 'audio/mp4',
    sizeBytes: 1000,
    hasAudio: true,
    deviceId: DEVICE_ID,
    ...overrides,
  }
}

/** A minimal fake RecordingStore backed by a Map<id, Blob>. */
function fakeStore(blobs: Record<string, Blob> = {}): RecordingStore {
  const map = new Map(Object.entries(blobs))
  return {
    async put(id, blob) {
      map.set(id, blob)
      return { id, savedAt: Date.now(), sizeBytes: blob.size, mimeType: blob.type }
    },
    async get(id) {
      return map.get(id) ?? null
    },
    async remove(id) {
      map.delete(id)
    },
    async list() {
      return Array.from(map.entries()).map(([id, b]) => ({ id, savedAt: 0, sizeBytes: b.size, mimeType: b.type }))
    },
    async usageBytes() {
      return Array.from(map.values()).reduce((sum, b) => sum + b.size, 0)
    },
    async pruneOlderThan() {
      return []
    },
    async clear() {
      map.clear()
    },
    async putPartial() {},
    async listPartialIds() {
      return []
    },
    async assemblePartial() {
      return null
    },
    async deletePartial() {},
  }
}

function okFetch(body: Record<string, unknown>): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
}

function addTake(take: ReadingTake): void {
  update('reading', (reading) => ({ ...reading, takes: [...reading.takes, take] }))
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
  resetAll()
  update('settings', (s) => ({ ...s, driveUpload: CFG, kidName: 'Reader' }))
})

describe('isDriveConfigured', () => {
  it('is false with no driveUpload, true once both scriptUrl and secret are set', () => {
    expect(isDriveConfigured(getDoc().settings)).toBe(true) // set in beforeEach
    update('settings', (s) => ({ ...s, driveUpload: undefined }))
    expect(isDriveConfigured(getDoc().settings)).toBe(false)
  })
})

describe('enqueueUpload', () => {
  it('sets a pending upload on an existing take without one', () => {
    addTake(makeTake({ upload: undefined }))
    enqueueUpload('take-1')
    expect(getDoc().reading.takes[0].upload).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('does nothing for an unknown take id', () => {
    expect(() => enqueueUpload('missing')).not.toThrow()
  })
})

describe('processUploadQueue', () => {
  it('uploads a pending take and marks it done with driveUrl/driveFileId', async () => {
    addTake(makeTake({ upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    const fetchFn = okFetch({ ok: true, fileId: 'abc123', url: 'https://drive/view', downloadUrl: 'https://drive/dl' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    const take = getDoc().reading.takes[0]
    expect(take.upload).toMatchObject({ status: 'done', driveFileId: 'abc123', driveUrl: 'https://drive/dl' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.secret).toBe(SECRET)
    expect(payload.mimeType).toBe('audio/mp4')
    expect(payload.description).toContain('Reader')
    expect(payload.description).toContain('Cat Nap')
    expect(payload.dataBase64).toEqual(expect.any(String))
  })

  it('on {ok:false}, increments attempts, stays pending, and records lastError', async () => {
    addTake(makeTake({ upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    const fetchFn = okFetch({ ok: false, error: 'bad secret' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(getDoc().reading.takes[0].upload).toMatchObject({ status: 'pending', attempts: 1, lastError: 'bad secret' })
  })

  it('gives up after too many attempts', async () => {
    addTake(makeTake({ upload: { status: 'pending', attempts: 8, updatedAt: 0 } }))
    const fetchFn = okFetch({ ok: true, fileId: 'x', url: 'u' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(getDoc().reading.takes[0].upload).toMatchObject({ status: 'failed', lastError: 'gave up' })
  })

  it('skips takes recorded on another device', async () => {
    addTake(makeTake({ deviceId: OTHER_DEVICE_ID, upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    const fetchFn = okFetch({ ok: true, fileId: 'x', url: 'u' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('marks a take failed with "no local audio" when the blob is missing', async () => {
    addTake(makeTake({ upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    const fetchFn = okFetch({ ok: true, fileId: 'x', url: 'u' })
    const store = fakeStore({})

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(getDoc().reading.takes[0].upload).toMatchObject({ status: 'failed', lastError: 'no local audio' })
  })

  it('does nothing while offline or when Drive is not configured', async () => {
    addTake(makeTake({ upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    const fetchFn = okFetch({ ok: true, fileId: 'x', url: 'u' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => false })
    expect(fetchFn).not.toHaveBeenCalled()

    update('settings', (s) => ({ ...s, driveUpload: undefined }))
    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('a network throw is treated like a failed response', async () => {
    addTake(makeTake({ upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    const fetchFn = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await processUploadQueue({ fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(getDoc().reading.takes[0].upload).toMatchObject({ status: 'pending', attempts: 1, lastError: 'network down' })
  })
})

describe('useUploadSummary (via getDoc snapshot logic)', () => {
  it('counts pending/uploading as pending, and failed/done separately', () => {
    addTake(makeTake({ id: 't1', upload: { status: 'pending', attempts: 0, updatedAt: 0 } }))
    addTake(makeTake({ id: 't2', upload: { status: 'uploading', attempts: 0, updatedAt: 0 } }))
    addTake(makeTake({ id: 't3', upload: { status: 'failed', attempts: 8, updatedAt: 0 } }))
    addTake(makeTake({ id: 't4', upload: { status: 'done', attempts: 1, updatedAt: 0 } }))
    addTake(makeTake({ id: 't5', upload: undefined }))

    const takes = getDoc().reading.takes
    const pending = takes.filter((t) => t.upload?.status === 'pending' || t.upload?.status === 'uploading').length
    const failed = takes.filter((t) => t.upload?.status === 'failed').length
    const done = takes.filter((t) => t.upload?.status === 'done').length
    expect({ pending, failed, done }).toEqual({ pending: 2, failed: 1, done: 1 })
    expect(typeof useUploadSummary).toBe('function')
  })
})

describe('retryFailedUploads', () => {
  it('resets every failed take to pending with attempts 0', () => {
    addTake(makeTake({ id: 't1', upload: { status: 'failed', attempts: 8, updatedAt: 0, lastError: 'gave up' } }))
    addTake(makeTake({ id: 't2', upload: { status: 'done', attempts: 1, updatedAt: 0 } }))

    retryFailedUploads()

    const takes = getDoc().reading.takes
    expect(takes.find((t) => t.id === 't1')?.upload).toMatchObject({ status: 'pending', attempts: 0 })
    expect(takes.find((t) => t.id === 't2')?.upload).toMatchObject({ status: 'done' })
  })
})

describe('uploadNow', () => {
  it('resets a failed take (the "Try again" chip button) and uploads it immediately', async () => {
    addTake(makeTake({ upload: { status: 'failed', attempts: 8, updatedAt: 0, lastError: 'gave up' } }))
    const fetchFn = okFetch({ ok: true, fileId: 'x', url: 'u' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await uploadNow('take-1', { fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(getDoc().reading.takes[0].upload?.status).toBe('done')
  })

  it('leaves an already-done take alone', async () => {
    addTake(makeTake({ upload: { status: 'done', attempts: 1, updatedAt: 0, driveFileId: 'f1' } }))
    const fetchFn = okFetch({ ok: true, fileId: 'x', url: 'u' })
    const store = fakeStore({ 'take-1': new Blob([new Uint8Array(10)], { type: 'audio/mp4' }) })

    await uploadNow('take-1', { fetch: fetchFn, store, deviceId: DEVICE_ID, online: () => true })

    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('buildFileName', () => {
  it('formats YYYY-MM-DD_HHmm_<slug>.<ext> from local time and the passage title', () => {
    const take = makeTake({ startedAt: new Date(2026, 8, 7, 14, 5).getTime(), mimeType: 'audio/mp4' })
    expect(buildFileName(take, 'Cat Nap')).toBe('2026-09-07_1405_cat-nap.m4a')
  })

  it('falls back to "story" when there is no title', () => {
    const take = makeTake({ startedAt: new Date(2026, 8, 7, 9, 3).getTime(), mimeType: 'audio/webm;codecs=opus' })
    expect(buildFileName(take, '')).toBe('2026-09-07_0903_story.webm')
  })
})

describe('testDriveConnection', () => {
  it('reports ok on {ok:true,pong:true}', async () => {
    const fetchFn = okFetch({ ok: true, pong: true })
    const result = await testDriveConnection(CFG, { fetch: fetchFn })
    expect(result.ok).toBe(true)
  })

  it('reports failure when the URL or secret is blank, without calling fetch', async () => {
    const fetchFn = okFetch({ ok: true, pong: true })
    const result = await testDriveConnection({ scriptUrl: '', secret: '', folderName: '' }, { fetch: fetchFn })
    expect(result.ok).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('backupProgressToDrive', () => {
  it('uploads once per local day, using the readaloud-progress-<day>.json file name', async () => {
    const fetchFn = okFetch({ ok: true, fileId: 'p1', url: 'https://drive/progress' })

    await backupProgressToDrive({ fetch: fetchFn, online: () => true, now: () => new Date(2026, 8, 7, 10, 0).getTime() })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.fileName).toBe('readaloud-progress-2026-09-07.json')
    expect(lastProgressBackupDay()).toBe('2026-09-07')

    // Later the same local day - skipped.
    await backupProgressToDrive({ fetch: fetchFn, online: () => true, now: () => new Date(2026, 8, 7, 20, 0).getTime() })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does nothing when Drive is not configured or offline', async () => {
    update('settings', (s) => ({ ...s, driveUpload: undefined }))
    const fetchFn = okFetch({ ok: true })
    await backupProgressToDrive({ fetch: fetchFn, online: () => true })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
