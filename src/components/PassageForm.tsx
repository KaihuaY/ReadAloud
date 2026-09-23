import { useState } from 'react'
import { LEVELS, type PassageLevel, type ReadingPassage } from '../content/passages'
import { wordCount } from '../content/textSplit'
import { addCustomPassage, updateCustomPassage } from '../store/customPassages'

const WORD_HINT_THRESHOLD = 60
const DEFAULT_EMOJI = '📖'

export type PassageFormSource = 'typed' | 'photo' | 'book-excerpt' | 'book-original'

export interface PassageFormInitial {
  id?: string
  title: string
  text: string
  level: PassageLevel
  emoji?: string
  sourceNote?: string
}

export interface PassageFormProps {
  initial?: PassageFormInitial
  source: PassageFormSource
  onSave: (passage: ReadingPassage) => void
  onCancel: () => void
}

const SOURCE_LABEL: Record<PassageFormSource, string> = {
  typed: 'Typed by a grown-up',
  photo: 'From a photo of a page',
  'book-excerpt': 'Excerpt found online',
  'book-original': '', // always shown from sourceNote instead - see sourceLabelFor
}

function sourceLabelFor(source: PassageFormSource, sourceNote?: string): string {
  if (source === 'book-original') return sourceNote ?? "Made up from the story - not the book's words"
  return SOURCE_LABEL[source]
}

/** Single input, textarea, level chooser: the shared save/edit form behind every "My passages" add flow. */
export function PassageForm({ initial, source, onSave, onCancel }: PassageFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [level, setLevel] = useState<PassageLevel>(initial?.level ?? 1)
  const [emoji, setEmoji] = useState(initial?.emoji ?? DEFAULT_EMOJI)
  const [error, setError] = useState<string | null>(null)

  const count = wordCount(text)
  const canSave = title.trim() !== '' && text.trim() !== ''

  function handleSave() {
    setError(null)
    try {
      if (initial?.id) {
        updateCustomPassage(initial.id, { title, text, level, emoji })
        onSave({
          id: initial.id,
          level,
          title: title.trim(),
          text,
          emoji: emoji.trim() !== '' ? emoji.trim() : DEFAULT_EMOJI,
          wordCount: count,
          focus: LEVELS.find((l) => l.level === level)?.focus ?? '',
          source: source as ReadingPassage['source'],
          sourceNote: initial.sourceNote,
        })
      } else {
        const passage = addCustomPassage({
          title,
          text,
          level,
          emoji,
          source,
          sourceNote: source === 'book-original' ? initial?.sourceNote : undefined,
        })
        onSave(passage)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving that passage.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Story title" />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
        Emoji
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
          style={{ width: '4ch' }}
          maxLength={2}
        />
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <span style={{ fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Level</span>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {LEVELS.map((l) => (
            <button
              key={l.level}
              type="button"
              className="cc-btn"
              data-testid={`passage-form-level-${l.level}`}
              onClick={() => setLevel(l.level)}
              style={{
                flex: '1 1 120px',
                background: level === l.level ? 'var(--cc-primary)' : 'var(--cc-surface)',
                color: level === l.level ? '#fff' : 'var(--cc-ink)',
                border: level === l.level ? 'none' : '2px solid var(--cc-border)',
                boxShadow: 'none',
                fontSize: '0.9rem',
              }}
            >
              {l.level}. {l.name}
            </button>
          ))}
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 700 }}>
        Text
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Type or paste the passage here"
          style={{ fontFamily: 'inherit', fontSize: '1rem', padding: '0.5rem', resize: 'vertical' }}
        />
      </label>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
        {count} {count === 1 ? 'word' : 'words'}
        {count > WORD_HINT_THRESHOLD ? ' - keep it under 60 words for a beginner' : ''}
      </p>

      <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--cc-ink-soft)' }}>
        Source: {sourceLabelFor(source, initial?.sourceNote)}
      </p>

      {error && <p style={{ margin: 0, color: 'var(--cc-danger)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="cc-btn cc-btn-primary" disabled={!canSave} onClick={handleSave}>
          Save
        </button>
        <button type="button" className="cc-btn cc-btn-surface" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
