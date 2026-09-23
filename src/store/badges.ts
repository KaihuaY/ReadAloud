// Persists newly-earned badges (diffing src/content/badges.ts's pure
// earnedBadges() against rewards.badges) and hands the result to a small
// toast queue any screen can render. `useBadgeAwards()` is the hook that
// wires "the doc changed in a way that could earn a badge" to "check and
// queue a toast" - mounted by whichever screen wants that behavior (see
// components/BadgeToast.tsx, which mounts it for you).

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { earnedBadges } from '../content/badges'
import { getDoc, update, useProgress, type EarnedBadge, type ProgressDoc } from './progress'
import { passageTakes } from './reading'

/**
 * Diffs earnedBadges(getDoc()) against rewards.badges, appends any ids not
 * already on record (stamped with the current time), and returns just the
 * newly-earned ids. A no-op (no doc write at all) when nothing new was
 * earned, so calling this repeatedly is always safe.
 */
export function awardNewBadges(): string[] {
  const doc = getDoc()
  const already = new Set((doc.rewards.badges ?? []).map((b) => b.id))
  const newIds = earnedBadges(doc).filter((id) => !already.has(id))
  if (newIds.length === 0) return []

  const now = Date.now()
  update('rewards', (rewards) => ({
    ...rewards,
    badges: [...(rewards.badges ?? []), ...newIds.map((id): EarnedBadge => ({ id, earnedAt: now }))],
  }))
  return newIds
}

// ---------------------------------------------------------------------------
// Pending badge-toast queue - a module-level external store (not React
// state) so any number of screens can push into and read the same queue.
// ---------------------------------------------------------------------------

export interface BadgeToastEntry {
  id: string
}

let toastQueue: BadgeToastEntry[] = []
const toastListeners = new Set<() => void>()

function notifyToasts(): void {
  for (const l of toastListeners) l()
}

function subscribeToasts(cb: () => void): () => void {
  toastListeners.add(cb)
  return () => toastListeners.delete(cb)
}

function getToastsSnapshot(): BadgeToastEntry[] {
  return toastQueue
}

/** The current queue of "new badge!" toasts to show, oldest first. */
export function useBadgeToasts(): BadgeToastEntry[] {
  return useSyncExternalStore(subscribeToasts, getToastsSnapshot, getToastsSnapshot)
}

/** Removes one toast from the queue (tap-to-dismiss, or the auto-hide timer). */
export function dismissBadgeToast(id: string): void {
  if (!toastQueue.some((t) => t.id === id)) return
  toastQueue = toastQueue.filter((t) => t.id !== id)
  notifyToasts()
}

function pushBadgeToasts(ids: string[]): void {
  if (ids.length === 0) return
  const existing = new Set(toastQueue.map((t) => t.id))
  const fresh = ids.filter((id) => !existing.has(id)).map((id) => ({ id }))
  if (fresh.length === 0) return
  toastQueue = [...toastQueue, ...fresh]
  notifyToasts()
}

/**
 * A cheap fingerprint of exactly the doc fields that can move a badge from
 * unearned to earned (streak bests, take/star counts, practice retirements,
 * and the badges already on record) - lets useBadgeAwards skip re-checking
 * on unrelated re-renders.
 */
function badgeSignature(doc: ProgressDoc): string {
  const realTakes = passageTakes(doc.reading.takes)
  const threeStarReads = realTakes.filter((t) => t.score?.stars === 3).length
  const retiredWords = Object.values(doc.reading.practice).filter((p) => p.ok >= 3).length

  return [
    doc.reading.streak.best,
    realTakes.length,
    threeStarReads,
    retiredWords,
    doc.collection.items.length,
    doc.rewards.badges?.length ?? 0,
  ].join('|')
}

/**
 * Mounted by any screen that should check for newly-earned badges and queue
 * a toast for each one. Runs on mount and again whenever the doc changes in
 * a way badgeSignature() considers relevant. See components/BadgeToast.tsx,
 * which mounts this for you along with rendering the queue.
 */
export function useBadgeAwards(): void {
  const progress = useProgress()
  const lastSignature = useRef<string | null>(null)

  useEffect(() => {
    const signature = badgeSignature(progress)
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    pushBadgeToasts(awardNewBadges())
  }, [progress])
}
