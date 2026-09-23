import { useReading } from '../store/reading'
import { markNoteSeen, useUnseenNotes } from '../store/notes'
import { SayIt } from './SayIt'
import { TakePlayer } from './TakePlayer'

/**
 * The newest unseen note from a grown-up, with its voice clip (if any) and a
 * "Got it" button that marks it seen. Renders nothing when there is none -
 * safe to mount unconditionally (the integrator mounts it at the top of Home).
 */
export function NoteCard() {
  const unseen = useUnseenNotes()
  const reading = useReading()
  const note = unseen[0]

  if (!note) return null

  const take = note.audioTakeId ? reading.takes.find((t) => t.id === note.audioTakeId) : undefined

  return (
    <div
      className="cc-card"
      style={{ padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#fff4f8' }}
    >
      <strong style={{ fontSize: '1.05rem' }}>💌 A note from your grown-up</strong>
      {note.text && <p style={{ margin: 0 }}>{note.text}</p>}
      {take && <TakePlayer take={take} />}
      {note.text && <SayIt text={note.text} />}
      <button
        type="button"
        className="cc-btn cc-btn-primary"
        style={{ alignSelf: 'flex-start', minHeight: 56 }}
        onClick={() => markNoteSeen(note.id)}
      >
        Got it 💛
      </button>
    </div>
  )
}
