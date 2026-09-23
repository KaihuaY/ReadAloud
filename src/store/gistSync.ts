import { useSyncExternalStore } from 'react'
import { getDoc, importJson, mergeDocs, subscribe, type ProgressDoc } from './progress'

/**
 * The document as it is stored in the gist: COMPACT JSON. The human export
 * (exportJson) is pretty-printed, which made the synced file ~2.4x bigger
 * than its data - and GitHub truncates gist files over 1 MB in API
 * responses. Parsing is identical, so old and new builds interoperate.
 */
function syncJson(): string {
  return JSON.stringify(getDoc())
}

// ---------------------------------------------------------------------------
// GitHub Gist sync: keeps ProgressDoc backed up to (and synced across
// devices via) a single private gist, one file. This is a deliberately
// simple "last-writer-wins per section" sync, not a CRDT - see mergeDocs()
// in progress.ts for the exact merge semantics.
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'readaloud.gh.token'
const GIST_ID_KEY = 'readaloud.gh.gistId'
const FILE_NAME = 'readaloud-progress.json'
const GIST_DESCRIPTION = 'Read Aloud progress (auto-synced - do not rename the file)'
const DEBOUNCE_MS = 2000
const RETRY_MS = 30000
const POLL_MS = 60000

export type SyncStatus = 'off' | 'loading' | 'saved' | 'saving' | 'offline' | 'expired' | 'error'

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

// --- token storage -----------------------------------------------------

export function getToken(): string | null {
  if (!hasLocalStorage()) return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore - storage may be unavailable (private browsing, quota, etc.)
  }
}

export function clearToken(): void {
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(GIST_ID_KEY)
    } catch {
      // ignore
    }
  }
  stop()
  setStatus('off')
}

function getCachedGistId(): string | null {
  if (!hasLocalStorage()) return null
  try {
    return localStorage.getItem(GIST_ID_KEY)
  } catch {
    return null
  }
}

function setCachedGistId(id: string): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(GIST_ID_KEY, id)
  } catch {
    // ignore
  }
}

// --- status observable ---------------------------------------------------

let status: SyncStatus = 'off'
const statusListeners = new Set<() => void>()

function setStatus(next: SyncStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener()
}

export function getStatus(): SyncStatus {
  return status
}

export function subscribeStatus(cb: () => void): () => void {
  statusListeners.add(cb)
  return () => statusListeners.delete(cb)
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus)
}

// --- sync engine -----------------------------------------------------------

let gistId: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let unsubscribeStore: (() => void) | null = null
let started = false
// True while we're writing a remote-originated change into the local store,
// so the store-change listener that triggers uploads can tell "this change
// came from the server" apart from "this change came from the user" and
// avoid immediately re-uploading what was just downloaded (an echo loop).
let applyingRemote = false
let lastSyncedJson: string | null = null
let lastKnownRemoteUpdatedAt: string | null = null

interface GistFile {
  content?: string
  truncated?: boolean
  /** Present on every file; the only way to read the full content of one GitHub truncated (over ~1 MB). */
  raw_url?: string
}
interface GistSummary {
  id: string
  files: Record<string, GistFile>
}
interface GistDetail extends GistSummary {
  updated_at: string
}

/**
 * GitHub truncates a gist file's `content` in the detail response once it's
 * over ~1 MB (`truncated: true`) - a progress doc with enough takes/history
 * can get there. When that happens, `raw_url` still serves the full text (no
 * auth header needed, harmless to send none). Falls back to whatever
 * `content` there is (likely itself truncated, so probably unparsable JSON -
 * the caller's own JSON.parse/schema check already treats that as
 * "malformed, skip" rather than crashing) if the raw fetch fails.
 */
async function resolveFileContent(file: GistFile): Promise<string> {
  if (file.truncated && file.raw_url) {
    try {
      const res = await fetch(file.raw_url)
      if (res.ok) return await res.text()
    } catch {
      // Fall through to file.content below.
    }
  }
  return file.content ?? ''
}

async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  if (!token) throw new Error('Read Aloud: no GitHub token set')
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(init?.headers ?? {}),
    },
  })
}

/** Finds a gist holding this app's progress file by its exact name. */
async function findOrCreateGist(): Promise<string> {
  const cached = getCachedGistId()
  if (cached) return cached

  const listRes = await githubFetch('/gists?per_page=100')
  if (listRes.status === 401) {
    setStatus('expired')
    throw new Error('Read Aloud: GitHub token expired or invalid')
  }
  if (!listRes.ok) throw new Error(`Read Aloud: failed to list gists (${listRes.status})`)
  const gists = (await listRes.json()) as GistSummary[]
  const existing = gists.find((g) => Object.keys(g.files).includes(FILE_NAME))
  if (existing) {
    setCachedGistId(existing.id)
    return existing.id
  }

  // No gist has the progress file yet - start one.
  const createRes = await githubFetch('/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [FILE_NAME]: { content: syncJson() } },
    }),
  })
  if (createRes.status === 401) {
    setStatus('expired')
    throw new Error('Read Aloud: GitHub token expired or invalid')
  }
  if (!createRes.ok) throw new Error(`Read Aloud: failed to create gist (${createRes.status})`)
  const created = (await createRes.json()) as GistSummary
  setCachedGistId(created.id)
  return created.id
}

async function fetchGistDetail(id: string): Promise<GistDetail> {
  const res = await githubFetch(`/gists/${id}`)
  if (res.status === 401) {
    setStatus('expired')
    throw new Error('Read Aloud: GitHub token expired or invalid')
  }
  if (!res.ok) throw new Error(`Read Aloud: failed to fetch gist (${res.status})`)
  return (await res.json()) as GistDetail
}

/** PATCHes only this app's file. */
async function pushToGist(content: string): Promise<void> {
  if (!gistId) return
  setStatus('saving')
  const res = await githubFetch(`/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [FILE_NAME]: { content } } }),
  })
  if (res.status === 401) {
    setStatus('expired')
    throw new Error('Read Aloud: GitHub token expired or invalid')
  }
  if (!res.ok) throw new Error(`Read Aloud: failed to save gist (${res.status})`)
  const data = (await res.json()) as GistDetail
  lastSyncedJson = content
  lastKnownRemoteUpdatedAt = data.updated_at
  setStatus('saved')
}

/**
 * Merges remote content into the local store. Returns true if, after the
 * merge, the local doc holds something the remote doesn't have yet (e.g. the
 * remote file was empty, or the merge kept a section from local because it
 * was newer) - callers use this to push the merged doc back up, which
 * matters in particular when this is running as part of a retry after a
 * failed upload: without it, the edit that failed to push would only ever
 * get merged back into `local` and never actually reach the gist.
 */
function applyRemoteContent(remoteJson: string): boolean {
  if (!remoteJson) {
    lastSyncedJson = syncJson()
    return true
  }
  let remoteDoc: ProgressDoc
  try {
    remoteDoc = JSON.parse(remoteJson) as ProgressDoc
  } catch {
    return false
  }
  // Defensive: a raw remote doc could be anything (a stray non-JSON string,
  // or some other gist file entirely) - mergeDocs() assumes it can read
  // `.updatedAt` off each section, so refuse anything that isn't at least a
  // same-schema-version progress doc rather than letting it crash the merge.
  if (!remoteDoc || typeof remoteDoc !== 'object' || (remoteDoc as { schemaVersion?: unknown }).schemaVersion !== 1) {
    return false
  }
  applyingRemote = true
  try {
    const merged = mergeDocs(getDoc(), remoteDoc)
    importJson(JSON.stringify(merged))
    lastSyncedJson = syncJson()
  } finally {
    applyingRemote = false
  }
  return lastSyncedJson !== remoteJson
}

function scheduleUpload(): void {
  // This change was us applying a download, not a local edit - don't
  // immediately turn around and re-upload it.
  if (applyingRemote) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const content = syncJson()
    if (content === lastSyncedJson) return
    pushToGist(content).catch(() => {
      if (status !== 'expired') scheduleRetry()
    })
  }, DEBOUNCE_MS)
}

function scheduleRetry(): void {
  setStatus('offline')
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    void trySync()
  }, RETRY_MS)
}

/** Pushes the current doc immediately (bypassing the debounce) after a merge revealed the remote is behind. */
function pushMergedResult(): void {
  pushToGist(syncJson()).catch(() => {
    if (status !== 'expired') scheduleRetry()
  })
}

async function trySync(): Promise<void> {
  try {
    if (!gistId) gistId = await findOrCreateGist()
    const detail = await fetchGistDetail(gistId)
    lastKnownRemoteUpdatedAt = detail.updated_at
    const ownFile = detail.files[FILE_NAME]
    const ownContent = ownFile ? await resolveFileContent(ownFile) : ''
    const needsPush = applyRemoteContent(ownContent)
    if (!unsubscribeStore) {
      unsubscribeStore = subscribe(scheduleUpload)
    }
    setStatus('saved')
    // Important on a retry after a failed push: the edit that failed to
    // upload was just merged back into the local doc above, but merging
    // alone never re-sends it - without this it would silently never reach
    // the gist until the user happened to make another edit.
    if (needsPush) pushMergedResult()
  } catch {
    if (status !== 'expired') scheduleRetry()
  }
}

async function pollForRemoteChanges(): Promise<void> {
  if (!gistId || document.visibilityState !== 'visible') return
  try {
    const detail = await fetchGistDetail(gistId)
    if (detail.updated_at !== lastKnownRemoteUpdatedAt) {
      lastKnownRemoteUpdatedAt = detail.updated_at
      const ownFile = detail.files[FILE_NAME]
      const ownContent = ownFile ? await resolveFileContent(ownFile) : ''
      if (applyRemoteContent(ownContent)) pushMergedResult()
    }
  } catch {
    // A missed poll is harmless; the next 60s tick (or a local edit) tries again.
  }
}

/** Starts syncing. No-op if there's no token yet, or if already started. */
export function start(): void {
  if (started) return
  if (!getToken()) {
    setStatus('off')
    return
  }
  started = true
  setStatus('loading')
  void trySync()

  if (typeof document !== 'undefined') {
    pollTimer = setInterval(() => {
      void pollForRemoteChanges()
    }, POLL_MS)
  }
}

/** Stops syncing and clears all in-memory sync state (token is left alone). */
export function stop(): void {
  started = false
  if (debounceTimer) clearTimeout(debounceTimer)
  if (retryTimer) clearTimeout(retryTimer)
  if (pollTimer) clearInterval(pollTimer)
  debounceTimer = null
  retryTimer = null
  pollTimer = null
  if (unsubscribeStore) {
    unsubscribeStore()
    unsubscribeStore = null
  }
  gistId = null
  lastSyncedJson = null
  lastKnownRemoteUpdatedAt = null
}
