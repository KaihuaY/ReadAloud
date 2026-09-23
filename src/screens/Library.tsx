import { useState } from 'react'
import { navigate } from '../router'
import { useProgress } from '../store/progress'
import { useReading } from '../store/reading'
import { LEVELS, passagesForLevel, type PassageLevel, type ReadingPassage } from '../content/passages'
import { myBooks } from '../store/customPassages'
import { LevelChips } from '../components/LevelChips'
import { PassageCard } from '../components/PassageCard'

const LEVEL_STORAGE_KEY = 'readaloud.library.level'

function clampLevel(n: number): PassageLevel {
  return Math.max(1, Math.min(8, Math.round(n))) as PassageLevel
}

function readStoredLevel(defaultLevel: PassageLevel): PassageLevel {
  try {
    const raw = sessionStorage.getItem(LEVEL_STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? clampLevel(parsed) : defaultLevel
  } catch {
    return defaultLevel
  }
}

function storeLevel(level: PassageLevel): void {
  try {
    sessionStorage.setItem(LEVEL_STORAGE_KEY, String(level))
  } catch {
    // ignore - just won't be remembered across a reload
  }
}

/** Stars a passage's best take is shown with, derived from its stored accuracy (see the plan's section 5). */
function starsForAccuracy(accuracy: number): 1 | 2 | 3 {
  if (accuracy >= 0.9) return 3
  if (accuracy >= 0.7) return 2
  return 1
}

export function Library() {
  const progress = useProgress()
  const reading = useReading()
  const readingLevel = progress.settings.readingLevel
  const [selected, setSelected] = useState<PassageLevel>(() => readStoredLevel(readingLevel))

  const levelOptions = LEVELS.filter(
    (l) => l.level >= clampLevel(readingLevel - 1) && l.level <= clampLevel(readingLevel + 1),
  )

  function selectLevel(level: number): void {
    const clamped = clampLevel(level)
    setSelected(clamped)
    storeLevel(clamped)
  }

  function statsFor(passage: ReadingPassage): { bestStars: 0 | 1 | 2 | 3; readCount: number } {
    const best = reading.passageBests[passage.id]
    const readCount = reading.takes.filter((t) => t.passageId === passage.id).length
    return { bestStars: best ? starsForAccuracy(best.accuracy) : 0, readCount }
  }

  const myBooksList: ReadingPassage[] = myBooks(progress.settings)
  const levelPassages = passagesForLevel(selected)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1rem 1rem 2rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.4rem' }}>📖 Books</h1>

      {myBooksList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <strong style={{ fontSize: '1.15rem' }}>📚 My books</strong>
          {myBooksList.map((passage) => {
            const { bestStars, readCount } = statsFor(passage)
            return (
              <PassageCard
                key={passage.id}
                passage={passage}
                bestStars={bestStars}
                readCount={readCount}
                onOpen={() => navigate(`/read/${passage.id}`)}
              />
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <LevelChips levels={levelOptions} selected={selected} onSelect={selectLevel} />
        {levelPassages.map((passage) => {
          const { bestStars, readCount } = statsFor(passage)
          return (
            <PassageCard
              key={passage.id}
              passage={passage}
              bestStars={bestStars}
              readCount={readCount}
              onOpen={() => navigate(`/read/${passage.id}`)}
            />
          )
        })}
      </div>
    </div>
  )
}
