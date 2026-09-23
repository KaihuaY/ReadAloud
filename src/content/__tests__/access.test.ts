import { describe, expect, it } from 'vitest'
import { checkSecret, SECRET_SHA256 } from '../access'

describe('checkSecret', () => {
  it('matches the secret word', async () => {
    expect(await checkSecret('readme')).toBe(true)
  })

  it('returns false for a word that does not match', async () => {
    expect(await checkSecret('nope')).toBe(false)
  })

  it('is case-insensitive', async () => {
    expect(await checkSecret('README')).toBe(true)
    expect(await checkSecret('ReadMe')).toBe(true)
  })

  it('trims whitespace', async () => {
    expect(await checkSecret('  readme  ')).toBe(true)
  })

  it('returns false for an empty or blank word', async () => {
    expect(await checkSecret('')).toBe(false)
    expect(await checkSecret('   ')).toBe(false)
  })

  it('SECRET_SHA256 is a lowercase hex digest', () => {
    expect(SECRET_SHA256).toMatch(/^[0-9a-f]+$/)
  })
})
