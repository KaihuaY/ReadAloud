import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { navigate } from '../router'
import { useProgress, type ReadingTake, type Settings, type WordStatus } from '../store/progress'
import { useReading, setParentStars, pruneRecordings } from '../store/reading'
import { readsForDay } from '../store/readingRewards'
import { retryEar, useEarStage } from '../store/ear'
import { requestReadingFeedback } from '../store/readingCoach'
import { dayOffset, lastNDays, localDay } from '../store/sessions'
import { passageById } from '../content/passages'
import { levelHint } from '../content/readingPhrases'
import { getRecordingStore, formatBytes } from '../store/recordings'
import { PinGate } from '../components/PinGate'
import { TakePlayer } from '../components/TakePlayer'
import { UploadChip } from '../components/UploadChip'
import { MiniLineChart, type MiniLineChartPoint } from '../components/MiniLineChart'
import { CoachNote } from '../components/CoachNote'

const TREND_DAYS = 14

/** "Today", "Yesterday", or "Monday, Sep 1" for any other local day. */
function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === dayOffset(today, -1)) return 'Yesterday'
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/** Short "9/22" axis label for the trend charts. */
function chartLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
}

const WORD_CHIP_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  padding: '0.15rem 0.5rem',
  borderRadius: '0.5rem',
  fontSize: '0.85rem',
  fontWeight: 700,
}

const WORD_STATUS_STYLE: Record<WordStatus, CSSProperties> = {
  read: { background: 'var(--cc-surface)', color: 'var(--cc-ink)', border: '1px solid var(--cc-border)' },
  stumbled: { background: 'var(--ra-sun)', color: 'var(--ra-sun-ink)', border: 'none' },
  different: { background: 'transparent', color: 'var(--cc-accent)', border: '2px solid var(--cc-accent)' },
  skipped: { background: 'var(--cc-border)', color: 'var(--cc-ink-soft)', border: 'none' },
}

function passageTitleAndEmoji(take: ReadingTake, settings: Settings): { title: string; emoji: string } {
  const passage = passageById(take.passageId, settings.customPassages)
  return { title: passage?.title ?? 'Story', emoji: passage?.emoji ?? '📖' }
}

/**
 * One take, collapsed by default (open for the newest day) - stars,
 * outcome, the honest numbers, playback/upload, the per-word table +
 * transcript, the coach note, and "Listen again" when the ear hasn't
 * finished this take yet.
 */
function TakeRow({ take, settings, defaultOpen }: { take: ReadingTake; settings: Settings; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [busyEar, setBusyEar] = useState(false)
  const earStage = useEarStage(take.id)
  const { title, emoji } = passageTitleAndEmoji(take, settings)
  const score = take.score
  const wallTime = new Date(take.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  async function handleListenAgain() {
    setBusyEar(true)
    try {
      await retryEar(take.id)
    } finally {
      setBusyEar(false)
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--cc-border)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'none',
          border: 'none',
          padding: 0,
          width: '100%',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {emoji} {title}
        </span>
        <span style={{ color: 'var(--cc-ink-soft)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {wallTime} · {score ? '⭐'.repeat(score.stars) || '—' : '…'} {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {score ? (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
              {score.outcome} · {Math.round(score.accuracy * 100)}% accuracy · {Math.round(score.wcpm)} wcpm ·{' '}
              {Math.round(take.ear?.readSeconds ?? take.durationSec)}s read
              {take.ear && <> · {Math.round(take.ear.confidence * 100)}% confidence</>}
            </p>
          ) : (
            <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>Not scored yet.</p>
          )}

          <TakePlayer take={take} />
          <UploadChip take={take} />

          {take.ear && take.ear.words.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {take.ear.words.map((w) => (
                <span key={w.i} style={{ ...WORD_CHIP_BASE, ...WORD_STATUS_STYLE[w.s] }}>
                  {w.w}
                  {w.heard ? ` → ${w.heard}` : ''}
                </span>
              ))}
            </div>
          )}

          {take.ear?.transcript && (
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>Transcript</summary>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>{take.ear.transcript}</p>
            </details>
          )}

          <CoachNote take={take} onRefresh={() => void requestReadingFeedback(take.id, { force: true })} />

          {take.earStatus !== 'done' && (
            <button
              type="button"
              className="cc-btn cc-btn-surface"
              style={{ alignSelf: 'flex-start' }}
              disabled={busyEar}
              onClick={() => void handleListenAgain()}
            >
              👂 Listen again{earStage !== 'idle' && earStage !== 'done' ? ` (${earStage})` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** One day's card: reads that day, the parent star rating, and every take. */
function DayCard({
  day,
  today,
  takes,
  settings,
  isNewestDay,
}: {
  day: string
  today: string
  takes: ReadingTake[]
  settings: Settings
  isNewestDay: boolean
}) {
  const reading = useReading()
  const reads = readsForDay(reading.takes, day)
  const rating = reading.days[day]?.parentStars

  return (
    <div className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <strong style={{ fontSize: '1.05rem' }}>{dayLabel(day, today)}</strong>
        <span style={{ color: 'var(--cc-ink-soft)', fontWeight: 700 }}>
          {reads} read{reads === 1 ? '' : 's'}
        </span>
      </div>

      {takes.map((take) => (
        <TakeRow key={take.id} take={take} settings={settings} defaultOpen={isNewestDay} />
      ))}

      {rating ? (
        <p style={{ margin: 0, fontWeight: 700, color: 'var(--cc-primary)' }}>Rated {'⭐'.repeat(rating)}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                className="cc-btn cc-btn-surface"
                style={{ minHeight: 56, flex: 1, fontSize: '1.1rem' }}
                onClick={() => setParentStars(day, n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
              >
                {'⭐'.repeat(n)}
              </button>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--cc-ink-soft)' }}>
            2 stars gives a silver token, 3 stars gives gold.
          </p>
        </div>
      )}
    </div>
  )
}

function ParentReviewContent() {
  const progress = useProgress()
  const reading = useReading()
  const settings = progress.settings
  const today = localDay()

  const trendDays = useMemo(() => lastNDays(TREND_DAYS, today), [today])

  const wpmPoints: MiniLineChartPoint[] = useMemo(
    () =>
      trendDays.map((day) => {
        const scored = reading.takes.filter((t) => t.day === day && t.score)
        const best = scored.length > 0 ? Math.max(...scored.map((t) => t.score!.wcpm)) : undefined
        return { label: chartLabel(day), value: best }
      }),
    [reading.takes, trendDays],
  )

  const accuracyPoints: MiniLineChartPoint[] = useMemo(
    () =>
      trendDays.map((day) => {
        const scored = reading.takes.filter((t) => t.day === day && t.score)
        const mean = scored.length > 0 ? scored.reduce((sum, t) => sum + t.score!.accuracy * 100, 0) / scored.length : undefined
        return { label: chartLabel(day), value: mean }
      }),
    [reading.takes, trendDays],
  )

  const hintText = useMemo(() => {
    const scoredAtLevel = reading.takes
      .filter((t) => t.score && passageById(t.passageId, settings.customPassages)?.level === settings.readingLevel)
      .sort((a, b) => a.startedAt - b.startedAt)
    const recentAccuracies = scoredAtLevel.slice(-5).map((t) => t.score!.accuracy)
    const hint = levelHint(recentAccuracies)
    if (hint === 'up') {
      return `She's reading this level cleanly - consider moving to level ${Math.min(8, settings.readingLevel + 1)} in Settings`
    }
    if (hint === 'down') {
      return `This level looks hard right now - level ${Math.max(1, settings.readingLevel - 1)} might feel better`
    }
    return 'This level looks like a good fit'
  }, [reading.takes, settings.customPassages, settings.readingLevel])

  const trickyWords = useMemo(() => {
    const trendSet = new Set(trendDays)
    const map = new Map<string, { word: string; count: number; lastDay: string }>()
    for (const t of reading.takes) {
      if (!trendSet.has(t.day) || !t.score) continue
      for (const word of t.score.trickyWords) {
        const key = word.toLowerCase()
        const existing = map.get(key)
        if (existing) {
          existing.count += 1
          if (t.day > existing.lastDay) existing.lastDay = t.day
        } else {
          map.set(key, { word, count: 1, lastDay: t.day })
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  }, [reading.takes, trendDays])

  const daysWithTakes = useMemo(() => {
    const byDay = new Map<string, ReadingTake[]>()
    for (const t of reading.takes) {
      const list = byDay.get(t.day)
      if (list) list.push(t)
      else byDay.set(t.day, [t])
    }
    for (const list of byDay.values()) list.sort((a, b) => a.startedAt - b.startedAt)
    return Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  }, [reading.takes])

  const [recordingStats, setRecordingStats] = useState<{ count: number; bytes: number } | null>(null)
  useEffect(() => {
    const store = getRecordingStore()
    Promise.all([store.list(), store.usageBytes()]).then(([items, bytes]) => {
      setRecordingStats({ count: items.length, bytes })
    })
    // Runs once on mount - the recordings store lives outside React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePrune() {
    const keepDays = settings.recordingKeepDays
    if (!window.confirm(`Delete recordings older than ${keepDays} days from this device? The audio can't be recovered.`)) {
      return
    }
    await pruneRecordings(keepDays)
    const store = getRecordingStore()
    const [items, bytes] = await Promise.all([store.list(), store.usageBytes()])
    setRecordingStats({ count: items.length, bytes })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem 1rem 3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>👀 Grown-ups</h1>
        <button type="button" className="cc-btn cc-btn-surface" onClick={() => navigate('/settings')}>
          ⚙️ Settings
        </button>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <strong style={{ fontSize: '1.05rem' }}>Trend</strong>
        <MiniLineChart points={wpmPoints} title="Words per minute" goodDirection="up" format={(v) => String(Math.round(v))} />
        <MiniLineChart points={accuracyPoints} title="Accuracy" goodDirection="up" format={(v) => `${Math.round(v)}%`} />
        <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>{hintText}</p>
      </section>

      {trickyWords.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong style={{ fontSize: '1.05rem' }}>☀️ Tricky words</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {trickyWords.map((entry) => (
              <span
                key={entry.word}
                style={{ ...WORD_CHIP_BASE, background: 'var(--ra-sun)', color: 'var(--ra-sun-ink)', fontSize: '0.95rem' }}
              >
                ☀️ {entry.word} ×{entry.count}
              </span>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <strong style={{ fontSize: '1.05rem' }}>Days</strong>
        {daysWithTakes.length === 0 ? (
          <div className="cc-card" style={{ padding: '1.25rem', textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 700 }}>No reads yet.</p>
          </div>
        ) : (
          daysWithTakes.map(([day, takes], i) => (
            <DayCard key={day} day={day} today={today} takes={takes} settings={settings} isNewestDay={i === 0} />
          ))
        )}
      </section>

      <section className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <strong style={{ fontSize: '1.05rem' }}>Recordings on this device</strong>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
          {recordingStats?.count ?? '…'} recording{recordingStats?.count === 1 ? '' : 's'} ·{' '}
          {recordingStats ? formatBytes(recordingStats.bytes) : '…'}
        </p>
        <button type="button" className="cc-btn cc-btn-surface" style={{ alignSelf: 'flex-start' }} onClick={() => void handlePrune()}>
          🗑️ Delete recordings older than {settings.recordingKeepDays} days
        </button>
      </section>
    </div>
  )
}

/** `/review`: the PIN-gated grown-up screen - trend, tricky words, day-by-day takes, and device recordings. */
export function ParentReview() {
  const progress = useProgress()
  const [unlocked, setUnlocked] = useState(false)

  if (!unlocked) {
    return <PinGate pin={progress.settings.pin} onUnlock={() => setUnlocked(true)} title="👀 Grown-ups" />
  }

  return <ParentReviewContent />
}
