import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEarStage, requestEar, retryPendingEars } from '../ear'
import { getDoc, resetAll, update, type ReadingTake } from '../progress'
import { getRecordingStore } from '../recordings'
import { passageById } from '../../content/passages'
import { tokenizeWords } from '../../content/textSplit'

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

const PASSAGE_ID = 'l1-cat-nap'
const passage = passageById(PASSAGE_ID)!
const WORDS = tokenizeWords(passage.text).map((t) => t.norm)

const CFG = { scriptUrl: 'https://script.google.com/exec', secret: 'shh', folderName: 'Read Aloud takes' }

function makeBlob(type = 'audio/webm'): Blob {
  return new Blob([new Uint8Array(10)], { type })
}

function addTake(overrides: Partial<ReadingTake> = {}): ReadingTake {
  const take: ReadingTake = {
    id: 'take-1',
    day: '2026-09-22',
    passageId: PASSAGE_ID,
    startedAt: Date.now(),
    durationSec: 10,
    mimeType: 'audio/mp4',
    sizeBytes: 100,
    hasAudio: true,
    deviceId: 'device-a',
    ...overrides,
  }
  update('reading', (reading) => ({ ...reading, takes: [...reading.takes, take] }))
  return take
}

function okReadResult(overrides: Record<string, unknown> = {}) {
  return {
    confidence: 0.95,
    readSeconds: 5,
    transcript: WORDS.join(' '),
    words: WORDS.map((w, i) => ({ i, w, s: 'read' as const })),
    extraWords: [],
    ...overrides,
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

const instantSleep = async (): Promise<void> => {}

beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
  resetAll()
  update('settings', (s) => ({ ...s, driveUpload: CFG, kidName: 'Reader' }))
  // The recording store is a real (fake-indexeddb) singleton shared across
  // tests in this file - clear it so one test's stored blobs never leak
  // into the next test's "audio is gone" assumptions.
  await getRecordingStore().clear()
})

describe('requestEar - happy path', () => {
  it('sets ear, score, stage done, and a passage best', async () => {
    addTake()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: okReadResult(), model: 'gemini-3.8-flash', usedToday: 1 }))

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep, now: () => 12345 })

    const take = getDoc().reading.takes[0]
    expect(take.ear).toBeDefined()
    expect(take.ear?.at).toBe(12345)
    expect(take.score).toBeDefined()
    expect(take.score?.outcome).toBe('full')
    expect(take.earStatus).toBe('done')
    expect(getEarStage('take-1')).toBe('done')
    expect(getDoc().reading.passageBests[PASSAGE_ID]).toBeDefined()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('posts action:read, the tokenized+normalized words, and blob.type as mimeType', async () => {
    addTake({ mimeType: 'audio/mp4' })
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: okReadResult() }))

    await requestEar('take-1', makeBlob('audio/webm;codecs=opus'), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.action).toBe('read')
    expect(payload.secret).toBe('shh')
    expect(payload.passageId).toBe(PASSAGE_ID)
    expect(payload.words).toEqual(WORDS)
    expect(payload.mimeType).toBe('audio/webm;codecs=opus') // blob.type wins over take.mimeType
  })
})

describe('requestEar - gates that send nothing', () => {
  it('scores a silent take as noReading locally without calling the ear', async () => {
    const take = addTake({ activeSec: 0, durationSec: 8 })
    const fetchMock = vi.fn()
    await requestEar(take.id, makeBlob(), { fetch: fetchMock as unknown as typeof fetch })
    expect(fetchMock).not.toHaveBeenCalled()
    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.earStatus).toBe('done')
    expect(saved.ear?.confidence).toBe(0)
    expect(saved.ear?.words.every((w) => w.s === 'skipped')).toBe(true)
    expect(saved.score?.outcome).toBe('noReading')
    expect(saved.score?.stars).toBe(0)
  })

  it('marks a take unsure when the ear claims far more reading than the mic heard', async () => {
    const take = addTake({ activeSec: 1, durationSec: 8 })
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, result: okReadResult({ readSeconds: 5 }) }))
    await requestEar(take.id, makeBlob(), { fetch: fetchMock as unknown as typeof fetch })
    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.ear?.unsure).toBe(true)
    expect(saved.score?.outcome).toBe('unsure')
    expect(saved.score?.stars).toBe(1)
  })

  it('still sends a take that has no activeSec (older takes) or heard enough', async () => {
    const take = addTake({ activeSec: 3 })
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, result: okReadResult() }))
    await requestEar(take.id, makeBlob(), { fetch: fetchMock as unknown as typeof fetch })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing and marks failed when ear.enabled is false', async () => {
    addTake()
    update('settings', (s) => ({ ...s, ear: { enabled: false } }))
    const fetchFn = vi.fn()

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch })

    expect(fetchFn).not.toHaveBeenCalled()
    const take = getDoc().reading.takes[0]
    expect(take.earStatus).toBe('failed')
    expect(getEarStage('take-1')).toBe('failed')
    expect(take.ear).toBeUndefined()
  })

  it('sends nothing and marks failed when Drive is not configured', async () => {
    addTake()
    update('settings', (s) => ({ ...s, driveUpload: undefined }))
    const fetchFn = vi.fn()

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(getDoc().reading.takes[0].earStatus).toBe('failed')
  })
})

describe('requestEar - retry behavior', () => {
  it('retries once on timeout, then fails', async () => {
    addTake()
    const fetchFn = vi.fn(async () => {
      throw abortError()
    })

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(getDoc().reading.takes[0].earStatus).toBe('failed')
    expect(getEarStage('take-1')).toBe('failed')
  })

  it('retries once on a cap response, then fails', async () => {
    addTake()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: false, reason: 'cap' }))

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(getDoc().reading.takes[0].earStatus).toBe('failed')
  })

  it('does not retry a plain http-404', async () => {
    addTake()
    const fetchFn = vi.fn(async () => jsonResponse({}, 404))

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(getDoc().reading.takes[0].earStatus).toBe('failed')
  })

  it('fails without retrying on unparseable JSON', async () => {
    addTake()
    const fetchFn = vi.fn(async () => new Response('not json', { status: 200 }))

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(getDoc().reading.takes[0].earStatus).toBe('failed')
  })
})

describe('requestEar - records and badges wiring (passage takes)', () => {
  it('updates records and awards badges once a passage take is scored', async () => {
    addTake()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: okReadResult() }))

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    // first-read is earned as soon as there's one real (non-word) take.
    expect((getDoc().rewards.badges ?? []).map((b) => b.id)).toContain('first-read')
    expect(getDoc().reading.records?.mostReadsInDay).toMatchObject({ value: 1 })
  })
})

describe('requestEar - word-practice takes ("Try just this word")', () => {
  const WORD_PASSAGE_ID = 'word:cat'

  function addWordTake(overrides: Partial<ReadingTake> = {}): ReadingTake {
    return addTake({ id: 'take-1', passageId: WORD_PASSAGE_ID, durationSec: 4, ...overrides })
  }

  it('posts words: [word] instead of resolving a passage', async () => {
    addWordTake()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: { confidence: 0.95, readSeconds: 1, transcript: 'cat', words: [{ i: 0, w: 'cat', s: 'read' }], extraWords: [] },
      }),
    )

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.words).toEqual(['cat'])
    expect(payload.passageId).toBe(WORD_PASSAGE_ID)
  })

  it('scores the take, calls recordPractice, and skips passage-best/coach', async () => {
    addWordTake()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: { confidence: 0.95, readSeconds: 1, transcript: 'cat', words: [{ i: 0, w: 'cat', s: 'read' }], extraWords: [] },
      }),
    )

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    const take = getDoc().reading.takes[0]
    expect(take.score).toBeDefined()
    expect(take.score?.outcome).toBe('full')
    expect(getDoc().reading.practice.cat).toMatchObject({ tries: 1, ok: 1 })
    // No passage best is ever recorded for a word-practice "passage".
    expect(getDoc().reading.passageBests[WORD_PASSAGE_ID]).toBeUndefined()
  })

  it('records a failed try (skipped/different) without crediting practice.ok', async () => {
    addWordTake()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: { confidence: 0.9, readSeconds: 1, transcript: '', words: [{ i: 0, w: 'cat', s: 'skipped' }], extraWords: [] },
      }),
    )

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(getDoc().reading.practice.cat).toMatchObject({ tries: 1, ok: 0 })
  })

  it('never shows up in records or the reading-goal-relevant badge counts', async () => {
    addWordTake()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: { confidence: 0.95, readSeconds: 1, transcript: 'cat', words: [{ i: 0, w: 'cat', s: 'read' }], extraWords: [] },
      }),
    )

    await requestEar('take-1', makeBlob(), { fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(getDoc().reading.records?.mostReadsInDay).toBeUndefined()
    expect((getDoc().rewards.badges ?? []).map((b) => b.id)).not.toContain('first-read')
  })
})

describe('retryPendingEars', () => {
  it('picks up every pending take with local audio and calls fetch once each', async () => {
    addTake({ id: 'take-1', earStatus: 'pending' })
    addTake({ id: 'take-2', earStatus: 'pending' })
    // A done take must be left alone.
    addTake({ id: 'take-3', earStatus: 'done' })

    const store = getRecordingStore()
    await store.put('take-1', makeBlob())
    await store.put('take-2', makeBlob())
    await store.put('take-3', makeBlob())

    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: okReadResult() }))

    await retryPendingEars({ fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    const takes = getDoc().reading.takes
    expect(takes.find((t) => t.id === 'take-1')?.earStatus).toBe('done')
    expect(takes.find((t) => t.id === 'take-2')?.earStatus).toBe('done')
    expect(takes.find((t) => t.id === 'take-3')?.earStatus).toBe('done') // unchanged, was never a candidate
  })

  it('marks a pending take failed if its local audio is gone', async () => {
    addTake({ id: 'take-1', earStatus: 'pending' })
    // Never put into the recording store - simulates audio pruned/never persisted.
    const fetchFn = vi.fn()

    await retryPendingEars({ fetch: fetchFn as unknown as typeof fetch, sleep: instantSleep })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(getDoc().reading.takes[0].earStatus).toBe('failed')
  })
})
