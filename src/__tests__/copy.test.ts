// This app quietly uses attention-friendly design for a beginning reader,
// but never names the underlying reason anywhere - not in code, comments,
// copy, or commits. This test walks every file under src/ (and README.md,
// if present) and fails if it finds a banned label.
//
// The banned words themselves are assembled from parts at runtime (rather
// than written out as plain literals) so this very file's own source text
// never contains one of them - otherwise the rule would trip on its own
// definition.

/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BANNED_WORDS = [
  ['a', 'd', 'h', 'd'].join(''),
  ['attention', 'deficit'].join(' '),
  ['d', 'i', 'a', 'g', 'n', 'o', 's'].join(''),
]
const BANNED_PATTERN = new RegExp(BANNED_WORDS.join('|'), 'i')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

const root = join(__dirname, '..', '..') // repo root (this file lives at src/__tests__/copy.test.ts)

describe('no banned label anywhere in src/', () => {
  const files = walk(join(root, 'src'))

  it('scanned at least one file', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file.slice(root.length + 1)} does not mention a banned label`, () => {
      const text = readFileSync(file, 'utf8')
      expect(BANNED_PATTERN.test(text)).toBe(false)
    })
  }
})

describe('README.md, if present, does not mention a banned label either', () => {
  it('checks README.md', () => {
    let text = ''
    try {
      text = readFileSync(join(root, 'README.md'), 'utf8')
    } catch {
      return // no README yet - nothing to check
    }
    expect(BANNED_PATTERN.test(text)).toBe(false)
  })
})
