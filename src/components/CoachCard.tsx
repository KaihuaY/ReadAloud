import type { ReadingTake } from '../store/progress'
import { useCoachStage } from '../store/readingCoach'
import { speakWord } from '../audio/speech'
import { SayIt } from './SayIt'

/**
 * Phase 1 fallback copy, used whenever `take.ai?.kid` hasn't landed yet
 * (Phase 2 wires the real AI coach). Priority: the outcomes with their own
 * gentle copy first, then star count for a full, accurate read.
 */
function rulesLine(take: ReadingTake): string {
  const score = take.score
  if (!score) return 'Listening back... 👂'
  if (score.outcome === 'noReading') return "I couldn't hear you that time. Come a bit closer and try again."
  if (score.outcome === 'unsure') return "I'm not sure I heard it all. Let's read it again!"
  if (score.outcome === 'partial') return 'You read the first part!'
  if (score.stars === 3) return 'You read every word! 🌟'
  if (score.stars === 2) return 'Nearly every word - super reading!'
  return 'You kept going. That is how readers grow!'
}

const trickyChipStyle = {
  minHeight: 'var(--cc-touch)',
  padding: '0.35rem 0.9rem',
  borderRadius: '999px',
  border: 'none',
  background: 'var(--ra-sun)',
  color: 'var(--ra-sun-ink)',
  fontWeight: 800,
  fontSize: '1.05rem',
  cursor: 'pointer',
} as const

/**
 * Praise + next step for one take, kid-facing only - never a percentage, a
 * number, or red (see the plan's hard rules; PIN-gated ParentReview is where
 * the numbers live). Phase 1: rules-only copy unless the AI coach (Phase 2)
 * already wrote `take.ai.kid`, in which case that's shown with a 🔊 SayIt
 * button and up to 3 tricky-word "sun" chips to tap and hear.
 */
export function CoachCard({ take }: { take: ReadingTake }) {
  const stage = useCoachStage(take.id)
  const kid = take.ai?.kid

  if (kid) {
    const trickyWords = kid.trickyWords.slice(0, 3)
    // The rules text is written synchronously and already showing above, so
    // this is a small addition under an already-full card - never a blank
    // one while Claude's upgrade is still in flight.
    const writing = stage === 'writing' && take.ai?.source === 'rules'

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div className="cc-card" style={{ padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>{kid.praise}</p>
          <SayIt text={`${kid.praise} ${kid.tryNext}`} />
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--cc-ink-soft)' }}>{kid.tryNext}</p>
          {trickyWords.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {trickyWords.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => speakWord(word)}
                  style={trickyChipStyle}
                  aria-label={`Hear the word ${word}`}
                >
                  ☀️ {word}
                </button>
              ))}
            </div>
          )}
        </div>
        {writing && (
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--cc-ink-soft)' }}>the coach is writing...</p>
        )}
      </div>
    )
  }

  return (
    <div className="cc-card" style={{ padding: '1.1rem' }}>
      <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>{rulesLine(take)}</p>
    </div>
  )
}
