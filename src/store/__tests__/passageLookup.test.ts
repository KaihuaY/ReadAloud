import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FIND_TITLE, findBook, levelHintText, ocrPage, truncateExcerptTo80Words } from '../passageLookup'
import { resetAll, update } from '../progress'

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

const CFG = { scriptUrl: 'https://script.google.com/exec', secret: 'shh', folderName: 'Read Aloud takes' }

function enableDrive(): void {
  update('settings', (s) => ({ ...s, driveUpload: CFG }))
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
})

describe('ocrPage', () => {
  it('returns ok with a tidied title/text/warnings on a good response', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ok: true, result: { title: '  My  Book  ', text: 'The cat  sat.', warnings: ['blurry line'] }, usedToday: 3 }),
    )
    const res = await ocrPage('base64data', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.result.title).toBe('My Book')
      expect(res.result.text).toBe('The cat sat.')
      expect(res.result.warnings).toEqual(['blurry line'])
      expect(res.usedToday).toBe(3)
    }
  })

  it('defaults warnings to [] when missing', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { title: 'T', text: 'hi' } }))
    const res = await ocrPage('x', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.result.warnings).toEqual([])
  })

  it('propagates a cap reason', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: false, reason: 'cap' }))
    const res = await ocrPage('x', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'cap', detail: undefined })
  })

  it('returns not-configured and never calls fetch when Drive is not set up', async () => {
    const fetchFn = vi.fn()
    const res = await ocrPage('x', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'not-configured' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns bad-json on an unparseable body', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => new Response('not json', { status: 200 }))
    const res = await ocrPage('x', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad-json')
  })

  it('returns bad-json when result is missing required string fields', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { title: 'T' } }))
    const res = await ocrPage('x', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'bad-json' })
  })

  it('returns timeout when fetch rejects with AbortError', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => {
      throw abortError()
    })
    const res = await ocrPage('x', 'image/jpeg', { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'timeout' })
    expect(fetchFn).toHaveBeenCalledTimes(1) // no retry
  })

  it('posts action:ocr with a plain-text content type', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { title: 'T', text: 'hi' } }))
    await ocrPage('imgdata', 'image/png', { fetch: fetchFn as unknown as typeof fetch })
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CFG.scriptUrl)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=utf-8')
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe('ocr')
    expect(body.secret).toBe('shh')
    expect(body.imageBase64).toBe('imgdata')
    expect(body.mediaType).toBe('image/png')
  })
})

describe('findBook', () => {
  it('truncates a long excerpt to at most 80 words, ending at a sentence', async () => {
    enableDrive()
    const sentence = 'The cat sat on the mat today.'
    const longText = new Array(30).fill(sentence).join(' ') // far more than 80 words
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { kind: 'excerpt', title: 'Book', text: longText, note: 'from the book' } }))
    const res = await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const wc = res.result.text.split(/\s+/).filter((w) => w.length > 0).length
      expect(wc).toBeLessThanOrEqual(80)
      expect(res.result.text.endsWith('.')).toBe(true)
      expect(res.result.kind).toBe('excerpt')
    }
  })

  it('forces the fixed note for kind original regardless of what the script sent', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { kind: 'original', title: 'Book', text: 'A made-up short story.', note: 'anything else' } }))
    const res = await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.result.note).toBe("Made up from the story - not the book's words")
  })

  it('handles kind none', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { kind: 'none', title: DEFAULT_FIND_TITLE, text: '', note: '' } }))
    const res = await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.result.kind).toBe('none')
  })

  it('returns bad-json when kind is not a recognized value', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { kind: 'mystery', title: 'Book', text: '', note: '' } }))
    const res = await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'bad-json' })
  })

  it('returns timeout when fetch rejects with AbortError, with no retry', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => {
      throw abortError()
    })
    const res = await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'timeout' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('returns not-configured and never calls fetch when Drive is not set up', async () => {
    const fetchFn = vi.fn()
    const res = await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    expect(res).toEqual({ ok: false, reason: 'not-configured' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('posts action, title, level, and a non-empty levelHint using the default fixture title', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, result: { kind: 'none', title: DEFAULT_FIND_TITLE, text: '', note: '' } }))
    await findBook(DEFAULT_FIND_TITLE, 3, { fetch: fetchFn as unknown as typeof fetch })
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe('find-book')
    expect(body.title).toBe(DEFAULT_FIND_TITLE)
    expect(body.level).toBe(3)
    expect(typeof body.levelHint).toBe('string')
    expect(body.levelHint.length).toBeGreaterThan(0)
  })
})

describe('truncateExcerptTo80Words', () => {
  it('leaves short text untouched', () => {
    expect(truncateExcerptTo80Words('one two three')).toBe('one two three')
  })
})

describe('levelHintText', () => {
  it('mentions the level focus and some sample words for every level', () => {
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const hint = levelHintText(level)
      expect(hint.length).toBeGreaterThan(0)
      expect(hint.toLowerCase()).toContain(`level ${level}`)
    }
  })
})
