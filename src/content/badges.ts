// The badge catalogue and the pure rule for which ones a doc has earned.
// Kept free of React/the progress store's `update()` so it's trivial to
// test; src/store/badges.ts is the thin stateful wrapper that persists
// newly-earned ids and fires toasts.

import { passagesForLevel, type PassageLevel } from './passages'
import { findItem, itemsInSet, type CollectionSet } from './collection'
import type { ProgressDoc } from '../store/progress'

export interface Badge {
  id: string
  title: string
  emoji: string
  /** Shown greyed-out on the shelf until earned - how to get it. */
  how: string
}

export const BADGES: Badge[] = [
  { id: 'first-read', title: 'First read', emoji: '📖', how: 'Read your first story out loud.' },
  { id: 'ten-reads', title: '10 reads', emoji: '🔟', how: 'Read 10 stories out loud.' },
  { id: 'fifty-reads', title: '50 reads', emoji: '🎉', how: 'Read 50 stories out loud.' },
  { id: 'streak-3', title: '3-day streak', emoji: '🔥', how: 'Read 3 days in a row.' },
  { id: 'streak-7', title: '7-day streak', emoji: '🔥', how: 'Read 7 days in a row.' },
  { id: 'streak-14', title: '14-day streak', emoji: '🔥', how: 'Read 14 days in a row.' },
  { id: 'streak-30', title: '30-day streak', emoji: '🔥', how: 'Read 30 days in a row.' },
  { id: 'first-three-stars', title: 'First 3 stars', emoji: '⭐', how: 'Get 3 stars on a story.' },
  { id: 'five-three-star-reads', title: '5 three-star reads', emoji: '🌟', how: 'Get 3 stars on 5 different reads.' },
  { id: 'level-done-1', title: 'Level 1 done', emoji: '1️⃣', how: 'Get 3 stars on every level 1 story.' },
  { id: 'level-done-2', title: 'Level 2 done', emoji: '2️⃣', how: 'Get 3 stars on every level 2 story.' },
  { id: 'level-done-3', title: 'Level 3 done', emoji: '3️⃣', how: 'Get 3 stars on every level 3 story.' },
  { id: 'level-done-4', title: 'Level 4 done', emoji: '4️⃣', how: 'Get 3 stars on every level 4 story.' },
  { id: 'level-done-5', title: 'Level 5 done', emoji: '5️⃣', how: 'Get 3 stars on every level 5 story.' },
  { id: 'level-done-6', title: 'Level 6 done', emoji: '6️⃣', how: 'Get 3 stars on every level 6 story.' },
  { id: 'level-done-7', title: 'Level 7 done', emoji: '7️⃣', how: 'Get 3 stars on every level 7 story.' },
  { id: 'level-done-8', title: 'Level 8 done', emoji: '8️⃣', how: 'Get 3 stars on every level 8 story.' },
  { id: 'tricky-tamer', title: 'Tricky word tamer', emoji: '☀️', how: 'Practise a tricky word until it retires.' },
  { id: 'first-card', title: 'First card', emoji: '🃏', how: 'Open a Blind Box and win your first collection card.' },
  { id: 'set-gems', title: 'Gem collector', emoji: '💎', how: 'Collect every card in the Gems & minerals set.' },
  { id: 'set-animals', title: 'Animal expert', emoji: '🦊', how: 'Collect every card in the Animals set.' },
  { id: 'set-space', title: 'Space explorer', emoji: '🪐', how: 'Collect every card in the Space set.' },
  { id: 'first-legendary', title: 'Legendary!', emoji: '🌟', how: 'Win a legendary collection card.' },
]

/** Whether every card in `set` is owned (count >= 1) in `doc.collection`. */
function setComplete(doc: ProgressDoc, set: CollectionSet): boolean {
  const ownedIds = new Set(doc.collection.items.filter((i) => i.count > 0).map((i) => i.id))
  const cards = itemsInSet(set)
  return cards.length > 0 && cards.every((c) => ownedIds.has(c.id))
}

/** Passage ids that ever got a 3-star take. */
function threeStarPassageIds(doc: ProgressDoc): Set<string> {
  const ids = new Set<string>()
  for (const t of doc.reading.takes) if (t.score?.stars === 3) ids.add(t.passageId)
  return ids
}

/** Whether every built-in passage at `level` has a 3-star take. */
function levelDone(doc: ProgressDoc, level: PassageLevel): boolean {
  const passages = passagesForLevel(level)
  if (passages.length === 0) return false
  const threeStars = threeStarPassageIds(doc)
  return passages.every((p) => threeStars.has(p.id))
}

/**
 * Every badge id `doc` currently qualifies for (order matches BADGES, not
 * earn order). Pure and cheap enough to call on every relevant doc change -
 * src/store/badges.ts diffs this against `rewards.badges` to find what's new.
 */
export function earnedBadges(doc: ProgressDoc): string[] {
  const out: string[] = []

  const realTakes = doc.reading.takes
  if (realTakes.length >= 1) out.push('first-read')
  if (realTakes.length >= 10) out.push('ten-reads')
  if (realTakes.length >= 50) out.push('fifty-reads')

  const streakBest = doc.reading.streak.best
  if (streakBest >= 3) out.push('streak-3')
  if (streakBest >= 7) out.push('streak-7')
  if (streakBest >= 14) out.push('streak-14')
  if (streakBest >= 30) out.push('streak-30')

  const threeStarReads = realTakes.filter((t) => t.score?.stars === 3).length
  if (threeStarReads >= 1) out.push('first-three-stars')
  if (threeStarReads >= 5) out.push('five-three-star-reads')

  for (let level = 1; level <= 8; level++) {
    if (levelDone(doc, level as PassageLevel)) out.push(`level-done-${level}`)
  }

  if (Object.values(doc.reading.practice).some((p) => p.ok >= 3)) out.push('tricky-tamer')

  if (doc.collection.items.length > 0) out.push('first-card')
  if (setComplete(doc, 'gems')) out.push('set-gems')
  if (setComplete(doc, 'animals')) out.push('set-animals')
  if (setComplete(doc, 'space')) out.push('set-space')
  if (doc.collection.items.some((i) => findItem(i.id)?.rarity === 'legendary')) out.push('first-legendary')

  return out
}
