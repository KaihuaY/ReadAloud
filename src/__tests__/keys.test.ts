// Read Aloud and KidEdu share the github.io origin, so every storage key
// must start with the new app prefix, never the old one - otherwise the two
// apps would read and write each other's localStorage/sessionStorage/
// IndexedDB data. This test walks every file under src/ and fails if it
// finds the old prefix anywhere.
//
// The old prefix is assembled from parts at runtime rather than written out
// as a plain literal, so this very file's own source text never contains
// it - otherwise the rule would trip on its own definition.

/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OLD_PREFIX = ['cubeclimb', '.'].join('')

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

const root = join(__dirname, '..', '..')

describe('no old-app storage key prefix anywhere in src/', () => {
  const files = walk(join(root, 'src'))

  it('scanned at least one file', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file.slice(root.length + 1)} does not contain the old prefix`, () => {
      const text = readFileSync(file, 'utf8')
      expect(text.includes(OLD_PREFIX)).toBe(false)
    })
  }
})
