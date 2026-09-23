import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearToken, setToken, start, stop } from '../gistSync'
import { defaultDoc, getDoc, resetAll, update, type ProgressDoc } from '../progress'

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

interface FakeGistFile {
  content: string
  truncated?: boolean
  raw_url?: string
}

interface FakeGist {
  id: string
  files: Record<string, FakeGistFile>
  updated_at: string
}

/**
 * A tiny in-memory stand-in for the bits of the GitHub Gists API gistSync.ts
 * uses: listing, creating, reading, and PATCHing one gist, plus serving
 * `raw_url` bodies for a truncated file.
 */
function fakeGithub(initial: FakeGist[] = [], rawFiles: Record<string, string> = {}) {
  const gists = initial
  let nextId = 1
  const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.hostname !== 'api.github.com') {
      const raw = rawFiles[String(input)]
      return raw !== undefined ? new Response(raw, { status: 200 }) : new Response('not found', { status: 404 })
    }
    if (url.pathname === '/gists' && method === 'GET') {
      return new Response(JSON.stringify(gists.map((g) => ({ id: g.id, files: g.files }))), { status: 200 })
    }
    if (url.pathname === '/gists' && method === 'POST') {
      const body = JSON.parse(init!.body as string) as { files: Record<string, { content: string }> }
      const created: FakeGist = { id: `gist-${nextId++}`, files: body.files, updated_at: new Date().toISOString() }
      gists.push(created)
      return new Response(JSON.stringify(created), { status: 201 })
    }
    const match = /^\/gists\/([^/]+)$/.exec(url.pathname)
    if (match && method === 'GET') {
      const gist = gists.find((g) => g.id === match[1])
      if (!gist) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(gist), { status: 200 })
    }
    if (match && method === 'PATCH') {
      const gist = gists.find((g) => g.id === match[1])
      if (!gist) return new Response('not found', { status: 404 })
      const body = JSON.parse(init!.body as string) as { files: Record<string, { content: string }> }
      gist.files = { ...gist.files, ...body.files }
      gist.updated_at = new Date().toISOString()
      return new Response(JSON.stringify(gist), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  })
  return { fetch: fetchFn, gists }
}

function docWithXp(xp: number): ProgressDoc {
  const doc = defaultDoc()
  doc.profile.xp = xp
  doc.profile.updatedAt = Date.now()
  return doc
}

function gistFile(doc: ProgressDoc): { content: string } {
  return { content: JSON.stringify(doc) }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  clearToken() // resets gistSync's in-memory state (timers, cached gist id, status) too
  resetAll()
})

describe('single-file write', () => {
  it("creates a gist holding only this app's own file", async () => {
    update('profile', (p) => ({ ...p, xp: 7 }))
    const { fetch, gists } = fakeGithub([])
    vi.stubGlobal('fetch', fetch)
    setToken('tok')
    start()

    await vi.waitFor(() => expect(gists).toHaveLength(1))
    expect(Object.keys(gists[0].files)).toEqual(['readaloud-progress.json'])
    const uploaded = JSON.parse(gists[0].files['readaloud-progress.json'].content) as ProgressDoc
    expect(uploaded.profile.xp).toBe(7)

    stop()
    vi.unstubAllGlobals()
  })
})

describe('gist discovery', () => {
  it('finds an existing gist by the readaloud-progress.json file name, not creating a second one', async () => {
    const { fetch, gists } = fakeGithub([
      { id: 'gist-1', files: { 'readaloud-progress.json': gistFile(docWithXp(1)) }, updated_at: new Date().toISOString() },
    ])
    vi.stubGlobal('fetch', fetch)
    setToken('tok')
    start()

    await vi.waitFor(() => expect(gists).toHaveLength(1))
    expect(gists[0].id).toBe('gist-1')

    stop()
    vi.unstubAllGlobals()
  })

  it('ignores any other file in the same gist', async () => {
    const { fetch, gists } = fakeGithub([
      {
        id: 'gist-1',
        files: {
          'readaloud-progress.json': gistFile(docWithXp(5)),
          'some-other-file.json': { content: '{"unrelated":true}' },
        },
        updated_at: new Date().toISOString(),
      },
    ])
    vi.stubGlobal('fetch', fetch)
    setToken('tok')
    start()

    await vi.waitFor(() => expect(getDoc().profile.xp).toBe(5))
    expect(gists[0].files['some-other-file.json'].content).toBe('{"unrelated":true}')

    stop()
    vi.unstubAllGlobals()
  })
})

describe('truncated gist file (GitHub truncates content over ~1MB)', () => {
  it('fetches raw_url for the truncated file and merges the full content', async () => {
    const remoteDoc = docWithXp(42)
    const rawUrl = 'https://gist.githubusercontent.com/raw/gist-1/readaloud-progress.json'
    const { fetch } = fakeGithub(
      [
        {
          id: 'gist-1',
          files: { 'readaloud-progress.json': { content: '{"trunc', truncated: true, raw_url: rawUrl } },
          updated_at: new Date().toISOString(),
        },
      ],
      { [rawUrl]: JSON.stringify(remoteDoc) },
    )
    vi.stubGlobal('fetch', fetch)
    setToken('tok')
    start()

    await vi.waitFor(() => expect(getDoc().profile.xp).toBe(42))

    stop()
    vi.unstubAllGlobals()
  })

  it('falls back to whatever content is present if the raw_url fetch fails, without crashing sync', async () => {
    const rawUrl = 'https://gist.githubusercontent.com/raw/gist-1/readaloud-progress.json'
    const { fetch, gists } = fakeGithub([
      {
        id: 'gist-1',
        files: { 'readaloud-progress.json': { content: '', truncated: true, raw_url: rawUrl } },
        updated_at: new Date().toISOString(),
      },
    ]) // no rawFiles entry -> the raw fetch 404s
    vi.stubGlobal('fetch', fetch)
    update('profile', (p) => ({ ...p, xp: 9 }))
    setToken('tok')
    start()

    await vi.waitFor(() => expect(gists[0].files['readaloud-progress.json']).toBeDefined())
    expect(getDoc().profile.xp).toBe(9)

    stop()
    vi.unstubAllGlobals()
  })
})
