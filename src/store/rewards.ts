// Pure, easily-testable helpers behind the reward economy (tokens, tiers,
// weighted prize/card picking, ticket rolls). Kept free of the progress
// store and any React so BlindBox.tsx and reading.ts can share the exact
// same rules, and so they're trivial to unit test.

import { COLLECTION, type CollectionItem } from '../content/collection'
import { RARITIES, type OwnedItem, type Prize, type Rarity } from './progress'

export type Tier = 'gold' | 'silver' | 'bronze'

export const TIERS: Tier[] = ['gold', 'silver', 'bronze']

export function starsForTier(tier: Tier): 1 | 2 | 3 {
  if (tier === 'gold') return 3
  if (tier === 'silver') return 2
  return 1
}

export interface Weighted {
  weight: number
}

/**
 * Picks one item from `items` with probability proportional to its `weight`.
 * Negative/zero weights are treated as zero. Returns undefined only if there
 * is nothing pickable (empty list or every weight <= 0).
 */
export function pickWeighted<T extends Weighted>(
  items: readonly T[],
  rng: () => number = Math.random,
): T | undefined {
  const weights = items.map((item) => Math.max(0, item.weight))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (items.length === 0 || total <= 0) return undefined

  let roll = rng() * total
  for (let i = 0; i < items.length; i++) {
    if (roll < weights[i]) return items[i]
    roll -= weights[i]
  }
  // Floating point rounding can leave a hair of `roll` >= 0 after the loop;
  // the last item with positive weight is the correct fallback.
  for (let i = items.length - 1; i >= 0; i--) {
    if (weights[i] > 0) return items[i]
  }
  return undefined
}

/** Whether opening a box of this tier also produces a prize ticket. */
export function rollTicket(chance: number, rng: () => number = Math.random): boolean {
  return rng() < Math.max(0, Math.min(1, chance))
}

/** XP awarded for a reward, scaled by tier. */
export function xpForTier(tier: Tier): number {
  if (tier === 'gold') return 30
  if (tier === 'silver') return 20
  return 10
}

/** Hard ceiling on any cash prize: it can never exceed $1, no matter what a pool's editor sets. */
const CASH_HARD_LIMIT_CENTS = 100
const CASH_STEP_CENTS = 5

/**
 * Rolls the actual dollar amount for a `kind: 'cash'` prize: a uniformly
 * random amount between the prize's min/max (defaulting to 5-100 cents),
 * rounded to the nearest nickel, and always clamped to 0-$1 so a bad prize
 * pool edit can never pay out more than the parent's hard limit.
 */
export function rollCashCents(prize: Prize, rng: () => number = Math.random): number {
  const rawMin = prize.minCents ?? 5
  const rawMax = prize.maxCents ?? 100
  const min = Math.max(0, Math.min(CASH_HARD_LIMIT_CENTS, Math.min(rawMin, rawMax)))
  const max = Math.max(0, Math.min(CASH_HARD_LIMIT_CENTS, Math.max(rawMin, rawMax)))

  const raw = min + rng() * (max - min)
  const stepped = Math.round(raw / CASH_STEP_CENTS) * CASH_STEP_CENTS
  // Clamp back into [min, max] in case rounding to the nearest nickel pushed
  // a value at the very edge of the range past it, then re-apply the
  // absolute $0-$1 hard limit.
  return Math.max(0, Math.min(CASH_HARD_LIMIT_CENTS, Math.max(min, Math.min(max, stepped))))
}

/** Formats a whole-cent amount as a dollar string, e.g. 65 -> "$0.65", 100 -> "$1.00". */
export function formatCents(cents: number): string {
  const dollars = Math.max(0, cents) / 100
  return `$${dollars.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Blind Box card rolls (photo collection, minus beads/bracelets)
// ---------------------------------------------------------------------------

/** How likely each card rarity is for a box of a given tier. */
export const RARITY_WEIGHTS: Record<Tier, Record<Rarity, number>> = {
  bronze: { common: 60, uncommon: 30, rare: 9, epic: 1, legendary: 0 },
  silver: { common: 40, uncommon: 35, rare: 18, epic: 6, legendary: 1 },
  gold: { common: 20, uncommon: 30, rare: 30, epic: 15, legendary: 5 },
}

/** Rolls a card rarity for a box of this tier, weighted by RARITY_WEIGHTS. */
export function rollRarity(tier: Tier, rng: () => number = Math.random): Rarity {
  const weights = RARITY_WEIGHTS[tier]
  const total = RARITIES.reduce((sum, r) => sum + weights[r], 0)
  if (total <= 0) return 'common'

  let roll = rng() * total
  for (const r of RARITIES) {
    if (roll < weights[r]) return r
    roll -= weights[r]
  }
  // Floating point rounding can leave a hair of `roll` >= 0 after the loop;
  // the highest rarity with positive weight is the correct fallback.
  for (let i = RARITIES.length - 1; i >= 0; i--) {
    if (weights[RARITIES[i]] > 0) return RARITIES[i]
  }
  return 'common'
}

/**
 * Picks one item of `rarity` from `items`, uniformly, never one whose id is
 * in `exclude` while an alternative exists. If `rarity` has no eligible
 * items, steps down through each lower rarity in turn; if every rarity is
 * exhausted, falls back to any eligible item, and finally (only if `exclude`
 * ruled out literally everything) to any item at all.
 */
export function pickItem(
  items: readonly CollectionItem[],
  rarity: Rarity,
  exclude: string[] = [],
  rng: () => number = Math.random,
): CollectionItem | undefined {
  const excluded = new Set(exclude)
  const startIndex = RARITIES.indexOf(rarity)

  for (let i = startIndex; i >= 0; i--) {
    const pool = items.filter((it) => it.rarity === RARITIES[i] && !excluded.has(it.id))
    if (pool.length > 0) return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  }

  const anyEligible = items.filter((it) => !excluded.has(it.id))
  const fallback = anyEligible.length > 0 ? anyEligible : items
  if (fallback.length === 0) return undefined
  return fallback[Math.min(fallback.length - 1, Math.floor(rng() * fallback.length))]
}

export interface BoxContents {
  item: CollectionItem
  rarity: Rarity
  duplicate: boolean
}

/**
 * Rolls the full contents of opening a box: a rarity, and a collection card
 * of that rarity (never the same as `lastItemId` when an alternative card
 * exists).
 */
export function rollBoxContents(
  tier: Tier,
  owned: readonly OwnedItem[],
  lastItemId?: string,
  rng: () => number = Math.random,
): BoxContents {
  const rarity = rollRarity(tier, rng)
  const item = pickItem(COLLECTION, rarity, lastItemId ? [lastItemId] : [], rng) ?? COLLECTION[0]
  const duplicate = owned.some((o) => o.id === item.id)
  return { item, rarity, duplicate }
}
