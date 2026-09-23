#!/usr/bin/env node
// Downloads the reward-collection photos from Wikimedia Commons (see
// scripts/collection-sources.json for the curated id -> File: title map) and
// writes src/content/collectionCredits.ts with the CREDITS the Credits
// screen (src/screens/Credits.tsx) and content test (collection.test.ts)
// rely on.
//
// Usage: node scripts/fetch-collection.mjs [id ...]     (no ids = all)
//        node scripts/fetch-collection.mjs --force [id ...]   (redownload)
//
// No dependencies - Node 20+ only.

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SOURCES_PATH = resolve(ROOT, 'scripts/collection-sources.json')
const OUT_DIR = resolve(ROOT, 'public/collection')
const CREDITS_PATH = resolve(ROOT, 'src/content/collectionCredits.ts')

const USER_AGENT = 'KidEdu-collection/1.0 (yukh27@gmail.com)'
const CONCURRENCY = 4
const WIDTH = 480

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Public domain, CC0, CC BY, or CC BY-SA (any version) - never a
// non-commercial or no-derivatives licence.
const FREE_LICENCE_RE = /^(pd|cc0|cc-by(-sa)?-\d)/i

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// The Commons API/CDN throttles bursts with HTTP 429/503; that is not a
// transient network failure so it gets its own polite backoff-and-retry
// loop (a handful of attempts, waiting longer each time) rather than
// counting against the single retry-on-network-error below.
async function fetchWithBackoff(url, options, maxAttempts = 6) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options)
    if (res.status !== 429 && res.status !== 503) return res
    if (attempt >= maxAttempts - 1) return res
    const retryAfter = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1)
    await sleep(wait)
  }
}

async function fetchJson(url) {
  const res = await fetchWithBackoff(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function withRetry(fn, label) {
  try {
    return await fn()
  } catch (err) {
    console.warn(`  retrying ${label} after error: ${err.message}`)
    await sleep(500)
    return fn()
  }
}

async function fetchImageInfo(title) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo' +
    '&iiprop=url|extmetadata|size|mime' +
    '&iiextmetadatafilter=LicenseShortName|License|Artist|Credit|UsageTerms' +
    `&titles=${encodeURIComponent(title)}&format=json&formatversion=2`
  const data = await withRetry(() => fetchJson(url), `imageinfo ${title}`)
  const page = data?.query?.pages?.[0]
  if (!page || page.missing || !page.imageinfo?.[0]) {
    throw new Error(`no imageinfo for ${title}`)
  }
  return page.imageinfo[0]
}

async function downloadFile(title, destPath) {
  const fileName = title.replace(/^File:/, '')
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=${WIDTH}`
  const res = await withRetry(async () => {
    const r = await fetchWithBackoff(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r
  }, `download ${title}`)
  await mkdir(dirname(destPath), { recursive: true })
  const fileStream = createWriteStream(destPath)
  await finished(Readable.fromWeb(res.body).pipe(fileStream))
}

async function processOne(id, title, force, credits, results) {
  try {
    const info = await fetchImageInfo(title)
    const meta = info.extmetadata ?? {}
    // License.value is the machine-readable code (e.g. "cc-by-sa-3.0") that
    // the free-licence allowlist is written against; LicenseShortName.value
    // is the human-readable label (e.g. "CC BY-SA 3.0") used for display.
    const licenseCode = meta.License?.value ?? ''
    const licenseLabel = meta.LicenseShortName?.value || licenseCode || 'Unknown'
    if (!FREE_LICENCE_RE.test(licenseCode)) {
      results.rejected.push({ id, title, reason: `non-free licence "${licenseLabel || licenseCode}"` })
      return
    }

    const destPath = resolve(OUT_DIR, `${id}.jpg`)
    let exists = false
    try {
      await stat(destPath)
      exists = true
    } catch {
      exists = false
    }
    if (!exists || force) {
      await downloadFile(title, destPath)
    }

    const fileName = title.replace(/^File:/, '')
    credits[id] = {
      author: stripHtml(meta.Artist?.value) || 'Unknown',
      license: licenseLabel,
      source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName).replace(/%2F/g, '/')}`,
    }

    // The file is saved with a .jpg extension regardless of source format,
    // but the width=480 Special:FilePath thumbnail should actually be a
    // JPEG and comfortably under 200 KB - flag it here if not, so a human
    // can swap in a better source (see SPEC in the task brief).
    let warning
    try {
      const bytes = await readFile(destPath)
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
      if (!isJpeg) warning = `not a real JPEG (${bytes.length} bytes) - pick a .jpg source instead`
      else if (bytes.length > 200_000) warning = `${Math.round(bytes.length / 1024)} KB, over the 200 KB budget - pick another source`
    } catch {
      // stat above already confirmed the file exists when skipping download.
    }
    results.ok.push({ id, title, warning })
  } catch (err) {
    results.rejected.push({ id, title, reason: err.message })
  }
}

async function runPool(items, worker, concurrency) {
  let cursor = 0
  async function next() {
    while (cursor < items.length) {
      const i = cursor++
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next))
}

function writeCreditsFile(credits) {
  const lines = []
  lines.push('// GENERATED by scripts/fetch-collection.mjs - do not edit by hand.')
  lines.push('// Photo credits for src/content/collection.ts, sourced from Wikimedia Commons.')
  lines.push('')
  lines.push('export const CREDITS: Record<string, { author: string; license: string; source: string }> = {')
  for (const id of Object.keys(credits).sort()) {
    const c = credits[id]
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    lines.push(`  '${id}': { author: '${esc(c.author)}', license: '${esc(c.license)}', source: '${esc(c.source)}' },`)
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const requestedIds = args.filter((a) => a !== '--force')

  const sources = JSON.parse(await readFile(SOURCES_PATH, 'utf8'))
  const ids = requestedIds.length > 0 ? requestedIds : Object.keys(sources)

  // Keep any previously-generated credits for ids we are not touching this run.
  let existingCredits = {}
  try {
    const prev = await readFile(CREDITS_PATH, 'utf8')
    const m = prev.match(/CREDITS[^=]*=\s*(\{[\s\S]*\})\s*$/)
    if (m) {
      // eslint-disable-next-line no-eval
      existingCredits = new Function(`return ${m[1]}`)()
    }
  } catch {
    existingCredits = {}
  }

  const credits = { ...existingCredits }
  const results = { ok: [], rejected: [] }
  const missing = ids.filter((id) => !sources[id])
  for (const id of missing) {
    results.rejected.push({ id, title: '(none)', reason: 'no entry in collection-sources.json' })
  }

  const workItems = ids.filter((id) => sources[id]).map((id) => ({ id, title: sources[id] }))
  await runPool(workItems, ({ id, title }) => processOne(id, title, force, credits, results), CONCURRENCY)

  await writeFile(CREDITS_PATH, writeCreditsFile(credits), 'utf8')

  console.log('\n--- fetch-collection results ---')
  console.log(`ok:       ${results.ok.length}`)
  for (const r of results.ok) {
    console.log(`  [ok]       ${r.id.padEnd(20)} ${r.title}`)
    if (r.warning) console.log(`             ${''.padEnd(20)} !! ${r.warning}`)
  }
  console.log(`rejected: ${results.rejected.length}`)
  for (const r of results.rejected) console.log(`  [rejected] ${r.id.padEnd(20)} ${r.reason}`)
  console.log(`missing (no source entry): ${missing.length}`)
  console.log('---------------------------------')

  if (results.rejected.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
