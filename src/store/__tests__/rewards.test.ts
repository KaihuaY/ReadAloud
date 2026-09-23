import { describe, expect, it } from 'vitest'
import {
  formatCents,
  pickItem,
  pickWeighted,
  rollBoxContents,
  rollCashCents,
  rollRarity,
  rollTicket,
  starsForTier,
  xpForTier,
} from '../rewards'
import { COLLECTION } from '../../content/collection'
import type { Prize } from '../progress'

describe('starsForTier / xpForTier', () => {
  it('maps each tier to its star count and xp', () => {
    expect(starsForTier('gold')).toBe(3)
    expect(starsForTier('silver')).toBe(2)
    expect(starsForTier('bronze')).toBe(1)
    expect(xpForTier('gold')).toBe(30)
    expect(xpForTier('silver')).toBe(20)
    expect(xpForTier('bronze')).toBe(10)
  })
})

describe('pickWeighted', () => {
  it('always returns the single positive-weight item', () => {
    const items = [{ id: 'a', weight: 0 }, { id: 'b', weight: 5 }, { id: 'c', weight: 0 }]
    for (let i = 0; i < 20; i++) {
      expect(pickWeighted(items, () => i / 20)?.id).toBe('b')
    }
  })

  it('returns undefined for an empty list or all-zero weights', () => {
    expect(pickWeighted([])).toBeUndefined()
    expect(pickWeighted([{ weight: 0 }, { weight: -1 }])).toBeUndefined()
  })
})

describe('rollTicket', () => {
  it('clamps the chance to 0..1', () => {
    expect(rollTicket(2, () => 0.99)).toBe(true) // clamped to 1
    expect(rollTicket(-1, () => 0.01)).toBe(false) // clamped to 0
  })
})

describe('rollCashCents', () => {
  it('rounds to the nearest nickel and clamps to the $0-$1 hard limit', () => {
    const prize: Prize = { id: 'p', name: 'Cash', emoji: '💵', weight: 1, kind: 'cash', minCents: 5, maxCents: 100 }
    const cents = rollCashCents(prize, () => 0.5)
    expect(cents % 5).toBe(0)
    expect(cents).toBeGreaterThanOrEqual(5)
    expect(cents).toBeLessThanOrEqual(100)
  })

  it('never exceeds 100 cents even if minCents/maxCents are set higher', () => {
    const prize: Prize = { id: 'p', name: 'Cash', emoji: '💵', weight: 1, kind: 'cash', minCents: 50, maxCents: 500 }
    expect(rollCashCents(prize, () => 1)).toBeLessThanOrEqual(100)
  })
})

describe('formatCents', () => {
  it('formats whole cents as a dollar string', () => {
    expect(formatCents(65)).toBe('$0.65')
    expect(formatCents(100)).toBe('$1.00')
    expect(formatCents(0)).toBe('$0.00')
  })
})

describe('rollRarity', () => {
  it('never returns legendary for a bronze box (zero weight)', () => {
    for (let i = 0; i < 20; i++) {
      expect(rollRarity('bronze', () => i / 20)).not.toBe('legendary')
    }
  })

  it('gold boxes can roll every rarity', () => {
    const rarities = new Set(Array.from({ length: 100 }, (_, i) => rollRarity('gold', () => i / 100)))
    expect(rarities.has('legendary')).toBe(true)
    expect(rarities.has('common')).toBe(true)
  })
})

describe('pickItem', () => {
  it('excludes the given id when an alternative of the same rarity exists', () => {
    const common = COLLECTION.filter((c) => c.rarity === 'common')
    expect(common.length).toBeGreaterThan(1)
    const excluded = common[0].id
    for (let i = 0; i < 20; i++) {
      const picked = pickItem(COLLECTION, 'common', [excluded], () => i / 20)
      expect(picked?.id).not.toBe(excluded)
    }
  })
})

describe('rollBoxContents', () => {
  it('rolls a rarity-appropriate card and flags a duplicate against owned items', () => {
    const owned = [{ id: COLLECTION[0].id, count: 1, firstAt: 1 }]
    const contents = rollBoxContents('gold', owned, undefined, () => 0)
    expect(contents.item).toBeDefined()
    expect(contents.rarity).toBeDefined()
    expect(typeof contents.duplicate).toBe('boolean')
  })

  it('never repeats lastItemId when an alternative of that rarity exists', () => {
    const rarity = rollRarity('bronze', () => 0)
    const alt = COLLECTION.find((c) => c.rarity === rarity)
    if (!alt) return
    for (let i = 0; i < 10; i++) {
      const contents = rollBoxContents('bronze', [], alt.id, () => 0)
      expect(contents.item.id).not.toBe(alt.id)
    }
  })
})
