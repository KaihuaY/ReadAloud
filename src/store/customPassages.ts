// Parent-typed / photographed / found-by-title reading passages, stored in
// settings.customPassages. Pure logic plus one React hook; see
// src/store/passageLookup.ts for how a photo or title search fills in
// addCustomPassage()'s input, and src/content/passages.ts for the built-in
// library and the seeded "My books" placeholder this merges with.

import { wordCount } from '../content/textSplit'
import { LEVELS, PASSAGES, SEED_BOOKS, type PassageLevel, type PassageSource, type ReadingPassage } from '../content/passages'
import { getDoc, update, useProgress, type Settings } from './progress'

const MAX_WORDS = 400
const DEFAULT_EMOJI = '📖'

function focusForLevel(level: PassageLevel): string {
  return LEVELS.find((l) => l.level === level)?.focus ?? ''
}

/** Collapses runs of spaces/tabs and trims - never touches newlines, which are meaningful sentence breaks in a typed or photographed passage. */
function tidyText(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through to the manual fallback below
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** This device's custom passages, newest (`addedAt`) first. */
function newestFirst(passages: readonly ReadingPassage[]): ReadingPassage[] {
  return [...passages].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
}

/** SEED_BOOKS, then this device's custom passages (newest first), then the built-in library - what Library shows. */
export function allPassages(settings: Settings): ReadingPassage[] {
  return [...SEED_BOOKS, ...newestFirst(settings.customPassages), ...PASSAGES]
}

/** SEED_BOOKS plus this device's custom passages (newest first) - the "My books" shelf, no built-in library. */
export function myBooks(settings: Settings): ReadingPassage[] {
  return [...SEED_BOOKS, ...newestFirst(settings.customPassages)]
}

export interface AddCustomPassageInput {
  title: string
  text: string
  level: PassageLevel
  source: 'typed' | 'photo' | 'book-excerpt' | 'book-original'
  sourceNote?: string
  emoji?: string
}

export interface AddCustomPassageDeps {
  now?: () => number
  id?: () => string
}

/**
 * Adds one parent-supplied passage to settings.customPassages and returns
 * it. Throws on an empty title/text (after trimming) or text over 400
 * words - callers show the message, nothing here is meant to be silent.
 */
export function addCustomPassage(input: AddCustomPassageInput, deps: AddCustomPassageDeps = {}): ReadingPassage {
  const title = input.title.trim()
  const text = tidyText(input.text)
  if (title === '') throw new Error('Title is required')
  if (text === '') throw new Error('Text is required')
  const count = wordCount(text)
  if (count > MAX_WORDS) throw new Error(`Passage is too long (${count} words, max ${MAX_WORDS})`)

  const now = deps.now ?? Date.now
  const nextId = deps.id ?? randomId
  const passage: ReadingPassage = {
    id: `custom-${nextId()}`,
    level: input.level,
    title,
    text,
    emoji: input.emoji && input.emoji.trim() !== '' ? input.emoji.trim() : DEFAULT_EMOJI,
    wordCount: count,
    focus: focusForLevel(input.level),
    source: input.source as PassageSource,
    sourceNote: input.sourceNote,
    addedAt: now(),
  }

  update('settings', (settings) => ({ ...settings, customPassages: [passage, ...settings.customPassages] }))
  return passage
}

/**
 * Patches a saved custom passage's title/text/level/emoji, recomputing
 * wordCount/focus whenever text or level changes. Checked before update()
 * so returns false (no write at all) when the id isn't a custom passage, or
 * the patch would change nothing.
 */
export function updateCustomPassage(id: string, patch: Partial<Pick<ReadingPassage, 'title' | 'text' | 'level' | 'emoji'>>): boolean {
  const settings = getDoc().settings
  const current = settings.customPassages.find((p) => p.id === id)
  if (!current) return false

  const nextTitle = patch.title !== undefined ? patch.title.trim() : current.title
  const nextText = patch.text !== undefined ? tidyText(patch.text) : current.text
  const nextLevel = patch.level !== undefined ? patch.level : current.level
  const nextEmoji = patch.emoji !== undefined ? patch.emoji : current.emoji

  const textOrLevelChanged = nextText !== current.text || nextLevel !== current.level
  const next: ReadingPassage = {
    ...current,
    title: nextTitle,
    text: nextText,
    level: nextLevel,
    emoji: nextEmoji,
    wordCount: textOrLevelChanged ? wordCount(nextText) : current.wordCount,
    focus: textOrLevelChanged ? focusForLevel(nextLevel) : current.focus,
  }

  if (next.title === current.title && next.text === current.text && next.level === current.level && next.emoji === current.emoji) {
    return false
  }

  update('settings', (s) => ({ ...s, customPassages: s.customPassages.map((p) => (p.id === id ? next : p)) }))
  return true
}

/** Removes a saved custom passage. Checked before update() so returns false (no write) if the id wasn't there. */
export function removeCustomPassage(id: string): boolean {
  const settings = getDoc().settings
  if (!settings.customPassages.some((p) => p.id === id)) return false
  update('settings', (s) => ({ ...s, customPassages: s.customPassages.filter((p) => p.id !== id) }))
  return true
}

export function useCustomPassages(): ReadingPassage[] {
  return useProgress().settings.customPassages
}
