#!/usr/bin/env node
// Prints the SHA-256 hex digest of a secret word, for CubeClimb's lock screen.
// Each kid (Nora, Amelia, ...) has her own word and her own entry in the
// `KIDS` array in src/content/access.ts.
//
// Usage: node scripts/hash-password.mjs <new word>

import { createHash } from 'node:crypto'

const word = (process.argv[2] ?? '').trim().toLowerCase()

if (!word) {
  console.error('Usage: node scripts/hash-password.mjs <new word>')
  process.exit(1)
}

const hash = createHash('sha256').update(word).digest('hex')

console.log(hash)
console.log(`Paste this as the secretSha256 for that kid's entry in the KIDS array in src/content/access.ts, then push.`)
