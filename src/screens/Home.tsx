import { navigate } from '../router'
import { useProgress } from '../store/progress'
import { readsForDay, goalProgress } from '../store/readingRewards'
import { localDay, lastNDays, dayOffset } from '../store/sessions'
import { passageById } from '../content/passages'
import { SayIt } from '../components/SayIt'
import { RingTimer } from '../components/RingTimer'
import { WeekDots } from '../components/WeekDots'
import { TokenPill } from '../components/TokenPill'
import { NoteCard } from '../components/NoteCard'
import { BadgeToast } from '../components/BadgeToast'

export function Home() {
  const progress = useProgress()
  const kidName = progress.settings.kidName
  const greeting = `Hi ${kidName}! Ready to read a story?`
  const today = localDay()
  const readsPerDay = progress.settings.readsPerDay
  const readsToday = readsForDay(progress.reading.takes, today)
  const ringProgress = goalProgress(readsToday, readsPerDay)

  const weekDays = lastNDays(7, today)
  const daysWithReads = new Set(weekDays.filter((day) => readsForDay(progress.reading.takes, day) > 0))

  // Today's take with the lowest stars below 3, if any - a gentle nudge to
  // try that one again rather than a new passage.
  const readAgainTake = progress.reading.takes
    .filter((t) => t.day === today && t.score && t.score.stars < 3)
    .sort((a, b) => (a.score?.stars ?? 0) - (b.score?.stars ?? 0))[0]
  const readAgainPassage = readAgainTake
    ? passageById(readAgainTake.passageId, progress.settings.customPassages)
    : undefined

  // Up to 3 tricky words practised in the last 14 days, for the sun-chip nudge.
  const trickyCutoff = dayOffset(today, -13)
  const recentTrickyWords = Array.from(
    new Set(
      progress.reading.takes
        .filter((t) => t.day >= trickyCutoff && (t.score?.trickyWords.length ?? 0) > 0)
        .flatMap((t) => t.score?.trickyWords ?? []),
    ),
  ).slice(0, 3)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1rem 1rem 2rem' }}>
      <BadgeToast />
      <NoteCard />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{greeting}</h1>
        <SayIt text={greeting} />
      </div>

      <div className="cc-card" style={{ padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <RingTimer progress={ringProgress} label={`${readsToday}/${readsPerDay}`} sublabel="today" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong>This week</strong>
          <WeekDots days={weekDays} done={daysWithReads} />
        </div>
      </div>

      <button
        type="button"
        className="cc-btn cc-btn-primary"
        style={{ minHeight: 96, fontSize: '1.3rem' }}
        onClick={() => navigate('/library')}
      >
        📖 Read a story
      </button>

      {readAgainPassage && (
        <button
          type="button"
          className="cc-card"
          style={{
            minHeight: 96,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '1rem 1.1rem',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onClick={() => navigate(`/read/${readAgainPassage.id}`)}
        >
          <span style={{ fontSize: '2rem' }} aria-hidden="true">
            {readAgainPassage.emoji}
          </span>
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Read it again: {readAgainPassage.title}</span>
        </button>
      )}

      {recentTrickyWords.length > 0 && (
        <button
          type="button"
          className="cc-card"
          style={{
            minHeight: 96,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '1rem 1.1rem',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onClick={() => navigate('/tricky')}
        >
          <strong style={{ fontSize: '1.1rem' }}>☀️ Tricky words</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {recentTrickyWords.map((w) => (
              <span
                key={w}
                style={{
                  background: 'var(--ra-sun)',
                  color: 'var(--ra-sun-ink)',
                  borderRadius: '0.5rem',
                  padding: '0.25rem 0.6rem',
                  fontWeight: 700,
                }}
              >
                {w}
              </span>
            ))}
          </div>
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <TokenPill tokens={progress.profile.tokens} />
        <button type="button" className="cc-btn cc-btn-surface" onClick={() => navigate('/box')} style={{ flex: 1 }}>
          🎁 Open a box
        </button>
      </div>
    </div>
  )
}
