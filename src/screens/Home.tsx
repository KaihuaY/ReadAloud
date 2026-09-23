import { navigate } from '../router'
import { useProgress } from '../store/progress'
import { readsForDay, goalProgress } from '../store/readingRewards'
import { localDay, lastNDays } from '../store/sessions'
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <TokenPill tokens={progress.profile.tokens} />
        <button type="button" className="cc-btn cc-btn-surface" onClick={() => navigate('/box')} style={{ flex: 1 }}>
          🎁 Open a box
        </button>
      </div>
    </div>
  )
}
