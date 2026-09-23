import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { RECORDINGS_DB, openRecordingStore, type RecordingStore } from '../recordings'

function makeBlob(bytes: number, type = 'audio/webm'): Blob {
  return new Blob([new Uint8Array(bytes)], { type })
}

let store: RecordingStore

beforeEach(() => {
  // A fresh IDBFactory per test so tests never see each other's databases.
  store = openRecordingStore(new IDBFactory())
})

describe('RECORDINGS_DB', () => {
  it('uses the readaloud namespace', () => {
    expect(RECORDINGS_DB).toBe('readaloud.recordings')
  })
})

describe('recordings store', () => {
  it('round-trips bytes and mime type through put/get', async () => {
    const blob = makeBlob(1234, 'audio/mp4')
    const meta = await store.put('take-1', blob, 1000)
    expect(meta).toEqual({ id: 'take-1', savedAt: 1000, sizeBytes: 1234, mimeType: 'audio/mp4' })

    const back = await store.get('take-1')
    expect(back).not.toBeNull()
    expect(back!.type).toBe('audio/mp4')
    const bytes = await back!.arrayBuffer()
    expect(bytes.byteLength).toBe(1234)
  })

  it('resolves null (not a rejection) for a missing id', async () => {
    await expect(store.get('missing')).resolves.toBeNull()
  })

  it('lists metadata sorted by savedAt', async () => {
    await store.put('b', makeBlob(10), 200)
    await store.put('a', makeBlob(10), 100)
    await store.put('c', makeBlob(10), 300)

    const list = await store.list()
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('removes a single id', async () => {
    await store.put('x', makeBlob(10), 1)
    await store.put('y', makeBlob(10), 2)
    await store.remove('x')

    const list = await store.list()
    expect(list.map((m) => m.id)).toEqual(['y'])
    expect(await store.get('x')).toBeNull()
  })

  it('prunes only ids strictly older than the cutoff and returns their ids', async () => {
    await store.put('old-1', makeBlob(10), 100)
    await store.put('old-2', makeBlob(10), 200)
    await store.put('at-cutoff', makeBlob(10), 500)
    await store.put('new-1', makeBlob(10), 900)

    const removed = await store.pruneOlderThan(500)
    expect(removed.sort()).toEqual(['old-1', 'old-2'])

    const remaining = (await store.list()).map((m) => m.id).sort()
    expect(remaining).toEqual(['at-cutoff', 'new-1'])
  })

  it('sums usage across all stored recordings', async () => {
    expect(await store.usageBytes()).toBe(0)
    await store.put('x', makeBlob(100), 1)
    await store.put('y', makeBlob(250), 2)
    expect(await store.usageBytes()).toBe(350)
  })

  it('clear empties the store', async () => {
    await store.put('x', makeBlob(10), 1)
    await store.put('y', makeBlob(10), 2)
    await store.clear()

    expect(await store.list()).toEqual([])
    expect(await store.usageBytes()).toBe(0)
  })
})

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

describe('partial chunks (in-progress take recovery)', () => {
  it('round-trips put/list/assemble/delete', async () => {
    await store.putPartial({
      id: 'take-x',
      seq: 0,
      bytes: bytesOf('AAAA'),
      mimeType: 'audio/webm',
      startedAt: 1000,
      passageId: 'passage-1',
      deviceId: 'dev-1',
    })
    await store.putPartial({
      id: 'take-x',
      seq: 1,
      bytes: bytesOf('BBBB'),
      mimeType: 'audio/webm',
      startedAt: 1000,
      passageId: 'passage-1',
      deviceId: 'dev-1',
    })

    expect(await store.listPartialIds()).toEqual(['take-x'])

    const assembled = await store.assemblePartial('take-x')
    expect(assembled).not.toBeNull()
    expect(assembled!.chunks).toBe(2)
    expect(assembled!.mimeType).toBe('audio/webm')
    expect(assembled!.startedAt).toBe(1000)
    expect(assembled!.passageId).toBe('passage-1')
    expect(await assembled!.blob.text()).toBe('AAAABBBB') // concatenated in seq order

    await store.deletePartial('take-x')
    expect(await store.listPartialIds()).toEqual([])
    expect(await store.assemblePartial('take-x')).toBeNull()
  })

  it('assembles out-of-order writes back into seq order', async () => {
    await store.putPartial({ id: 't', seq: 2, bytes: bytesOf('C'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })
    await store.putPartial({ id: 't', seq: 0, bytes: bytesOf('A'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })
    await store.putPartial({ id: 't', seq: 1, bytes: bytesOf('B'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })

    const assembled = await store.assemblePartial('t')
    expect(await assembled!.blob.text()).toBe('ABC')
  })

  it('overwrites a chunk written twice at the same seq instead of duplicating it', async () => {
    await store.putPartial({ id: 't', seq: 0, bytes: bytesOf('first'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })
    await store.putPartial({ id: 't', seq: 0, bytes: bytesOf('second'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })

    const assembled = await store.assemblePartial('t')
    expect(assembled!.chunks).toBe(1)
    expect(await assembled!.blob.text()).toBe('second')
  })

  it('assemblePartial resolves null (not a rejection) for an id with no chunks', async () => {
    await expect(store.assemblePartial('missing')).resolves.toBeNull()
  })

  it('deletePartial on an id with no chunks is a harmless no-op', async () => {
    await expect(store.deletePartial('missing')).resolves.toBeUndefined()
  })

  it('keeps chunks for different take ids independent', async () => {
    await store.putPartial({ id: 'a', seq: 0, bytes: bytesOf('A'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })
    await store.putPartial({ id: 'b', seq: 0, bytes: bytesOf('B'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })

    expect((await store.listPartialIds()).sort()).toEqual(['a', 'b'])

    await store.deletePartial('a')
    expect(await store.listPartialIds()).toEqual(['b'])
    expect(await store.assemblePartial('a')).toBeNull()
    const assembled = await store.assemblePartial('b')
    expect(await assembled!.blob.text()).toBe('B')
  })
})

describe('DB upgrade from v1 to v2', () => {
  it('keeps existing takes when a v1 database (no partials store) is reopened at v2', async () => {
    const factory = new IDBFactory()

    await new Promise<void>((resolve, reject) => {
      const req = factory.open(RECORDINGS_DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        const takesStore = db.createObjectStore('takes', { keyPath: 'id' })
        takesStore.createIndex('savedAt', 'savedAt')
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('takes', 'readwrite')
        tx.objectStore('takes').put({
          id: 'old-take',
          savedAt: 123,
          sizeBytes: 4,
          mimeType: 'audio/webm',
          bytes: bytesOf('OLD!'),
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const upgraded = openRecordingStore(factory)
    const blob = await upgraded.get('old-take')
    expect(blob).not.toBeNull()
    expect(await blob!.text()).toBe('OLD!')

    const list = await upgraded.list()
    expect(list.map((m) => m.id)).toEqual(['old-take'])

    expect(await upgraded.listPartialIds()).toEqual([])
    await upgraded.putPartial({ id: 'new-take', seq: 0, bytes: bytesOf('NEW'), mimeType: 'audio/webm', startedAt: 1, passageId: 'p', deviceId: 'd' })
    expect(await upgraded.listPartialIds()).toEqual(['new-take'])
  })
})
