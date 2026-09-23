import type { ReadingTake } from '../store/progress'
import { useCoachStage } from '../store/readingCoach'

/**
 * Grown-up-only coach feedback for one take: the written parent note, a
 * source tag, and a refresh button. Rendered only inside ParentReview,
 * itself PIN-gated - `ai.parent` must never appear anywhere else (see
 * CoachCard for the kid-facing text).
 */
export function CoachNote({ take, onRefresh }: { take: ReadingTake; onRefresh: () => void }) {
  const stage = useCoachStage(take.id)
  const writing = stage === 'writing'
  const ai = take.ai

  if (!ai) {
    return (
      <div data-testid="coach-note" className="cc-card" style={{ padding: '0.9rem' }}>
        <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>No note yet</p>
      </div>
    )
  }

  return (
    <div data-testid="coach-note" className="cc-card" style={{ padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <p style={{ margin: 0 }}>{ai.parent?.note ?? 'No note yet'}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--cc-ink-soft)' }}>
          {ai.source === 'claude' ? `Claude · ${ai.model ?? 'claude-opus-5'}` : 'Built-in phrases'}
        </span>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minHeight: 44 }}
          disabled={writing}
          onClick={onRefresh}
        >
          {writing ? 'Writing…' : '↻ Refresh'}
        </button>
      </div>
    </div>
  )
}
