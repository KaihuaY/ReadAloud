// Exercises the recordingSession singleton against FakeAudioBackend. This
// test environment is node (no window/document), so the visibilitychange /
// pagehide wiring and the real wake lock are never reached - those are
// guarded defensively in recordingSession.ts/wakeLock.ts and are not
// covered here.

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeAudioBackend, type FakeScript } from '../fakeBackend'
import { dismiss, getSessionState, isRecordingActive, recoverUnfinishedTakes, setAudioBackend, startTake, stopTake } from '../recordingSession'
import { getDoc, resetAll, update } from '../../store/progress'
import { getRecordingStore } from '../../store/recordings'

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const LOUD_SCRIPT: FakeScript = [
  { rms: 0.004, ms: 200 },
  { rms: 0.3, ms: 4200 },
]

const SILENT_SCRIPT: FakeScript = [{ rms: 0.004, ms: 3000 }]

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
  dismiss()
})

describe('recordingSession', () => {
  it('goes idle -> starting -> recording, tagging the state with the passageId', async () => {
    setAudioBackend(new FakeAudioBackend(LOUD_SCRIPT, { tickMs: 100 }))
    expect(getSessionState().status).toBe('idle')

    await startTake('l1-cat-nap')

    const state = getSessionState()
    expect(state.status).toBe('recording')
    if (state.status === 'recording') {
      expect(state.passageId).toBe('l1-cat-nap')
    }
    expect(isRecordingActive(getSessionState())).toBe(true)

    await stopTake('user')
  }, 8000)

  it('saves a take with the passageId once stopped past the 3s wall-time floor', async () => {
    setAudioBackend(new FakeAudioBackend(LOUD_SCRIPT, { tickMs: 100 }))
    await startTake('l1-cat-nap')

    await wait(3200)

    const beforeCount = getDoc().reading.takes.length
    await stopTake('user')

    const state = getSessionState()
    expect(state.status).toBe('done')
    if (state.status === 'done') {
      expect(state.discarded).toBe(false)
      expect(state.take.passageId).toBe('l1-cat-nap')
      expect(state.take.hasAudio).toBe(true)
    }
    expect(getDoc().reading.takes.length).toBe(beforeCount + 1)
  }, 8000)

  it('discards a very short take without saving it', async () => {
    setAudioBackend(new FakeAudioBackend(SILENT_SCRIPT, { tickMs: 100 }))
    await startTake('l1-cat-nap')

    await wait(1200)

    const beforeCount = getDoc().reading.takes.length
    await stopTake('user')

    const state = getSessionState()
    expect(state.status).toBe('done')
    if (state.status === 'done') expect(state.discarded).toBe(true)
    expect(getDoc().reading.takes.length).toBe(beforeCount)
  }, 8000)

  it('auto-stops once settings.maxRecordSeconds elapses, without an explicit stopTake', async () => {
    update('settings', (s) => ({ ...s, maxRecordSeconds: 3 }))
    setAudioBackend(new FakeAudioBackend(LOUD_SCRIPT, { tickMs: 100 }))
    const beforeCount = getDoc().reading.takes.length

    await startTake('l1-cat-nap')
    expect(getSessionState().status).toBe('recording')

    await wait(3400) // past the 3s auto-stop

    const state = getSessionState()
    expect(state.status).toBe('done')
    if (state.status === 'done') {
      expect(state.discarded).toBe(false)
      expect(state.take.passageId).toBe('l1-cat-nap')
    }
    expect(getDoc().reading.takes.length).toBe(beforeCount + 1)
  }, 8000)

  it('records listenedFirst on the saved take when requested', async () => {
    setAudioBackend(new FakeAudioBackend(LOUD_SCRIPT, { tickMs: 100 }))
    await startTake('l1-cat-nap', { listenedFirst: true })
    await wait(3200)
    await stopTake('user')

    expect(getDoc().reading.takes.at(-1)?.listenedFirst).toBe(true)
  }, 8000)

  it('dismiss() returns to idle from a done state, and is a no-op mid-recording', async () => {
    setAudioBackend(new FakeAudioBackend(SILENT_SCRIPT, { tickMs: 100 }))
    await startTake('l1-cat-nap')

    dismiss()
    expect(getSessionState().status).toBe('recording')

    await wait(1200)
    await stopTake('user')
    expect(getSessionState().status).toBe('done')

    dismiss()
    expect(getSessionState().status).toBe('idle')
  }, 8000)

  it('ignores a second startTake call while one is already active', async () => {
    setAudioBackend(new FakeAudioBackend(LOUD_SCRIPT, { tickMs: 100 }))
    await startTake('l1-cat-nap')

    await startTake('l1-fat-cat') // should be a no-op

    const state = getSessionState()
    expect(state.status).toBe('recording')
    if (state.status === 'recording') expect(state.passageId).toBe('l1-cat-nap')

    await stopTake('user')
  }, 8000)
})

describe('partial chunk persistence during recording', () => {
  it('writes chunks to the partials store while recording and clears them on a normal stop', async () => {
    setAudioBackend(new FakeAudioBackend(LOUD_SCRIPT, { tickMs: 100 }))
    await startTake('l1-cat-nap')

    await wait(450)

    const midFlightIds = await getRecordingStore().listPartialIds()
    expect(midFlightIds.length).toBe(1)

    await stopTake('user')

    expect(getSessionState().status).toBe('done')
    expect(await getRecordingStore().listPartialIds()).toEqual([])
  }, 8000)
})

describe('recoverUnfinishedTakes', () => {
  it('turns leftover partial chunks - as if the app died mid-recording - into a real take, exactly once', async () => {
    const store = getRecordingStore()
    const enc = new TextEncoder()
    const takeId = 'crash-take-1'
    await store.putPartial({
      id: takeId,
      seq: 0,
      bytes: enc.encode('chunk-0').buffer as ArrayBuffer,
      mimeType: 'audio/webm',
      startedAt: Date.now() - 5000,
      passageId: 'l1-cat-nap',
      deviceId: 'device-1',
    })
    await store.putPartial({
      id: takeId,
      seq: 1,
      bytes: enc.encode('chunk-1').buffer as ArrayBuffer,
      mimeType: 'audio/webm',
      startedAt: Date.now() - 5000,
      passageId: 'l1-cat-nap',
      deviceId: 'device-1',
    })

    const beforeCount = getDoc().reading.takes.length
    const recovered = await recoverUnfinishedTakes()
    expect(recovered).toBe(1)

    const takes = getDoc().reading.takes
    expect(takes.length).toBe(beforeCount + 1)
    const recoveredTake = takes.find((t) => t.id === takeId)
    expect(recoveredTake).toBeDefined()
    expect(recoveredTake?.passageId).toBe('l1-cat-nap')
    expect(recoveredTake?.hasAudio).toBe(true)
    expect(recoveredTake?.durationSec).toBe(2) // 2 chunks, ~1s each

    expect(await store.listPartialIds()).toEqual([])
    expect(await recoverUnfinishedTakes()).toBe(0) // nothing left to recover a second time
  })

  it('carries listenedFirst over from a matching inflight checkpoint', async () => {
    const store = getRecordingStore()
    const enc = new TextEncoder()
    const takeId = 'crash-take-listened'
    await store.putPartial({
      id: takeId,
      seq: 0,
      bytes: enc.encode('chunk-0').buffer as ArrayBuffer,
      mimeType: 'audio/webm',
      startedAt: Date.now() - 5000,
      passageId: 'l1-cat-nap',
      deviceId: 'device-1',
    })
    sessionStorage.setItem(
      'readaloud.reading.inflight',
      JSON.stringify({ id: takeId, activeMs: 1000, startedAt: Date.now() - 5000, passageId: 'l1-cat-nap', listenedFirst: true }),
    )

    const recovered = await recoverUnfinishedTakes()
    expect(recovered).toBe(1)
    expect(getDoc().reading.takes.find((t) => t.id === takeId)?.listenedFirst).toBe(true)
  })
})
