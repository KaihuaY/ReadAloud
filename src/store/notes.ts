// Actions on the `notes` section of the ProgressDoc - messages a grown-up
// leaves for the kid, shown on Home until she taps "Got it".

import { useMemo } from 'react'
import { localDay } from './sessions'
import { update, useProgress, type Note, type ProgressDoc } from './progress'

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through to the manual fallback below
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Adds a note from the grown-up. `day` defaults to today (local); returns the saved note. */
export function addNote(note: Omit<Note, 'id' | 'createdAt' | 'day'> & { day?: string }): Note {
  const full: Note = {
    id: randomId(),
    day: note.day ?? localDay(),
    about: note.about,
    text: note.text,
    audioTakeId: note.audioTakeId,
    createdAt: Date.now(),
  }
  update('notes', (notes) => ({ ...notes, items: [...notes.items, full] }))
  return full
}

/** Marks a note as seen (tapped "Got it"). Safe to call for an id that no longer exists. */
export function markNoteSeen(id: string): void {
  update('notes', (notes) => ({
    ...notes,
    items: notes.items.map((n) => (n.id === id ? { ...n, seenAt: Date.now() } : n)),
  }))
}

/** Notes not yet seen, newest first. */
export function unseenNotes(doc: Pick<ProgressDoc, 'notes'>): Note[] {
  return doc.notes.items
    .filter((n) => !n.seenAt)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function useUnseenNotes(): Note[] {
  const progress = useProgress()
  return useMemo(() => unseenNotes(progress), [progress])
}
