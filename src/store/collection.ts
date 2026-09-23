// Actions on the `collection` section of the ProgressDoc: the photo cards
// she owns. Thin wrappers around `update()` plus one React hook. Which card
// a box holds is decided by the callers (BlindBox) with the pure helpers in
// src/store/rewards.ts; this module only keeps the counts consistent.

import { getDoc, update, useProgress, type CollectionSection, type OwnedItem } from './progress'

export function useCollection(): CollectionSection {
  return useProgress().collection
}

export function ownedItem(id: string, collection: CollectionSection = getDoc().collection): OwnedItem | undefined {
  return collection.items.find((i) => i.id === id)
}

/**
 * Records a collection card drop. Returns whether it was a duplicate and the
 * new count.
 */
export function awardItem(id: string, at: number = Date.now()): { duplicate: boolean; count: number } {
  const existing = ownedItem(id)
  const count = (existing?.count ?? 0) + 1
  update('collection', (c) => ({
    ...c,
    items: existing
      ? c.items.map((i) => (i.id === id ? { ...i, count } : i))
      : [...c.items, { id, count: 1, firstAt: at }],
  }))
  return { duplicate: Boolean(existing), count }
}
