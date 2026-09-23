import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { navigate } from '../router'
import { useReading } from '../store/reading'
import { useTrickyWords } from '../store/trickyWords'
import { normalizeWord } from '../content/textSplit'
import { cancelSpeech, speakWord } from '../audio/speech'
import { dismiss, startTake, stopTake, useRecordingSession, type SessionState } from '../audio/recordingSession'
import { fireConfetti } from '../components/Confetti'
import { WordChip } from '../components/WordChip'
import { LevelMeter } from '../components/LevelMeter'

const RETIRE_AT_OK = 3
const WORD_TAKE_MAX_SECONDS = 8
const SAY_WITH_ME_PAUSE_MS = 1500
const RETIRE_CELEBRATE_MS = 1600

const screenStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  padding: '1rem 1rem 2rem',
  alignItems: 'center',
  textAlign: 'center',
}

/** The passageId a session state is currently about, or null (idle/error/saving carry no passageId worth matching). */
function sessionPassageId(s: SessionState): string | null {
  if (s.status === 'starting' || s.status === 'recording') return s.passageId
  if (s.status === 'done') return s.take.passageId
  return null
}

/** Three sparkle slots, filled up to `ok` (out of RETIRE_AT_OK) - never a negative/red mark for the rest. */
function Sparkles({ ok }: { ok: number }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: '0.35rem', fontSize: '1.7rem' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ opacity: i < ok ? 1 : 0.25 }}>
          ✨
        </span>
      ))}
    </div>
  )
}

/**
 * Tricky words practice: one WordChip at a time from useTrickyWords(), with
 * a mini "Try just this word" take (8s, scored with words: [word]). Three
 * successful tries retires a word (it then drops out of the list on its
 * own - see trickyWords.ts's activeTricky()).
 */
export function Tricky() {
  const entries = useTrickyWords(5)
  const reading = useReading()
  const session = useRecordingSession()

  const [index, setIndex] = useState(0)
  const [practiceWord, setPracticeWord] = useState<string | null>(null)
  const processedTakeIdRef = useRef<string | null>(null)
  const sayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Always stop any in-flight speech (and its pending "say it with me"
  // follow-up) when this screen goes away.
  useEffect(() => {
    return () => {
      cancelSpeech()
      if (sayTimerRef.current) clearTimeout(sayTimerRef.current)
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    }
  }, [])

  // A word retiring shrinks the list - clamp at render time rather than in
  // an effect (no need to synchronize an external system, just derive it).
  const clampedIndex = entries.length === 0 ? 0 : Math.min(index, entries.length - 1)
  const current = entries[clampedIndex]
  const currentWord = current?.word ?? null
  // The word actually being practiced (set when "Try it" is tapped) takes
  // priority over the carousel's current word, so a retiring word keeps
  // showing its own celebration even after it drops out of the list.
  const activeWord = practiceWord ?? currentWord
  const activeNorm = activeWord ? normalizeWord(activeWord) : ''

  const sessionMatchesActive = activeWord !== null && sessionPassageId(session) === `word:${activeNorm}`
  const liveTake =
    sessionMatchesActive && session.status === 'done' && !session.discarded
      ? reading.takes.find((t) => t.id === session.take.id) ?? session.take
      : null
  const score = liveTake?.score
  const practiceOk = reading.practice[activeNorm]?.ok ?? 0

  // Celebrate + auto-advance exactly once when a take retires the word.
  useEffect(() => {
    if (!liveTake || !score || processedTakeIdRef.current === liveTake.id) return
    processedTakeIdRef.current = liveTake.id
    const said = score.read + score.stumbled >= 1
    if (said && practiceOk >= RETIRE_AT_OK) {
      fireConfetti()
      advanceTimerRef.current = setTimeout(() => {
        dismiss()
        setPracticeWord(null)
      }, RETIRE_CELEBRATE_MS)
    }
  }, [liveTake, score, practiceOk])

  function clearSayTimer(): void {
    if (sayTimerRef.current) {
      clearTimeout(sayTimerRef.current)
      sayTimerRef.current = null
    }
  }

  function handleHear(): void {
    clearSayTimer()
    cancelSpeech()
    if (activeWord) speakWord(activeWord)
  }

  function handleSayWithMe(): void {
    clearSayTimer()
    cancelSpeech()
    if (!activeWord) return
    const word = activeWord
    speakWord(word, { rate: 0.7 })
    sayTimerRef.current = setTimeout(() => {
      speakWord(word, { rate: 0.9 })
    }, SAY_WITH_ME_PAUSE_MS)
  }

  function handleTryIt(): void {
    if (!currentWord) return
    clearSayTimer()
    cancelSpeech()
    processedTakeIdRef.current = null
    setPracticeWord(currentWord)
    void startTake(`word:${normalizeWord(currentWord)}`, { maxSeconds: WORD_TAKE_MAX_SECONDS })
  }

  function handleTryAgain(): void {
    const word = practiceWord ?? currentWord
    if (!word) return
    dismiss()
    clearSayTimer()
    cancelSpeech()
    processedTakeIdRef.current = null
    void startTake(`word:${normalizeWord(word)}`, { maxSeconds: WORD_TAKE_MAX_SECONDS })
  }

  function handleDismissError(): void {
    dismiss()
    setPracticeWord(null)
  }

  function goPrev(): void {
    cancelSpeech()
    setIndex((i) => Math.max(0, i - 1))
  }

  function goNext(): void {
    cancelSpeech()
    setIndex((i) => Math.min(entries.length - 1, i + 1))
  }

  // --- No tricky words right now ------------------------------------------
  if (entries.length === 0) {
    return (
      <div style={screenStyle}>
        <span style={{ fontSize: '2rem' }} aria-hidden="true">
          ☀️
        </span>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>No tricky words right now. Go read a story! 📖</p>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={() => navigate('/library')}>
          📖 Go to books
        </button>
      </div>
    )
  }

  // --- Mic trouble ----------------------------------------------------------
  if (session.status === 'error' && sessionMatchesActive) {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>I can&apos;t hear you right now. Try again in a moment.</p>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={handleDismissError}>
          Try again
        </button>
      </div>
    )
  }

  // --- Warming up the mic --------------------------------------------------
  if (session.status === 'starting' && sessionMatchesActive) {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>Getting ready to listen... 👂</p>
      </div>
    )
  }

  // --- Recording -------------------------------------------------------------
  if (session.status === 'recording' && sessionMatchesActive) {
    return (
      <div style={screenStyle}>
        {activeWord && <WordChip word={activeWord} onHear={handleHear} />}
        <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>Say: {activeWord}</span>
        <LevelMeter level={session.level} />
        <button type="button" className="ra-record-btn ra-record-btn-recording" onClick={() => void stopTake('user')} aria-label="Stop">
          <span style={{ fontSize: '2.2rem' }} aria-hidden="true">
            ⏹
          </span>
          <span style={{ fontSize: '1rem' }}>Stop</span>
        </button>
      </div>
    )
  }

  // --- Saving ----------------------------------------------------------------
  if (session.status === 'saving' && sessionMatchesActive) {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>💾 Saving...</p>
      </div>
    )
  }

  // --- Done: too short ---------------------------------------------------------
  if (session.status === 'done' && session.discarded && sessionMatchesActive) {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>Let&apos;s try that again!</p>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={handleTryAgain}>
          Try again
        </button>
      </div>
    )
  }

  // --- Done: waiting on / result from the ear ---------------------------------
  if (session.status === 'done' && liveTake) {
    if (!score) {
      return (
        <div style={screenStyle}>
          <p className="cc-pulse" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
            Listening... 👂
          </p>
        </div>
      )
    }

    const said = score.read + score.stumbled >= 1
    const justRetired = said && practiceOk >= RETIRE_AT_OK

    if (justRetired) {
      return (
        <div style={screenStyle}>
          <p style={{ fontSize: '1.3rem', fontWeight: 800 }}>✨ You said it!</p>
          <Sparkles ok={practiceOk} />
          <p style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--cc-primary)' }}>That word is yours now! 🌟</p>
        </div>
      )
    }

    if (said) {
      return (
        <div style={screenStyle}>
          {activeWord && <WordChip word={activeWord} onHear={handleHear} />}
          <p style={{ fontSize: '1.3rem', fontWeight: 800 }}>✨ You said it!</p>
          <Sparkles ok={practiceOk} />
          <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
            <button
              type="button"
              className="cc-btn cc-btn-surface"
              style={{ minHeight: 'var(--cc-touch)', flex: 1 }}
              onClick={handleHear}
            >
              🔊 Hear it
            </button>
            <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96, flex: 1 }} onClick={handleTryAgain}>
              🎙️ Try it again
            </button>
          </div>
        </div>
      )
    }

    return (
      <div style={screenStyle}>
        {activeWord && <WordChip word={activeWord} onHear={handleHear} />}
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>Let&apos;s hear it once more</p>
        <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
          <button type="button" className="cc-btn cc-btn-surface" style={{ minHeight: 'var(--cc-touch)', flex: 1 }} onClick={handleHear}>
            🔊 Hear it
          </button>
          <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96, flex: 1 }} onClick={handleTryAgain}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  // --- Ready: carousel ---------------------------------------------------------
  return (
    <div style={screenStyle}>
      <h1 style={{ margin: 0, fontSize: '1.4rem' }}>☀️ Tricky words</h1>
      <span style={{ color: 'var(--cc-ink-soft)', fontWeight: 700 }}>
        word {clampedIndex + 1} of {entries.length}
      </span>
      <div aria-hidden="true" style={{ display: 'flex', gap: '0.4rem' }}>
        {entries.map((e, i) => (
          <span
            key={e.word}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i === clampedIndex ? 'var(--cc-primary)' : 'var(--cc-border)',
            }}
          />
        ))}
      </div>

      {currentWord && <WordChip word={currentWord} onHear={handleHear} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', width: '100%' }}>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minWidth: 'var(--cc-touch)', minHeight: 'var(--cc-touch)' }}
          onClick={goPrev}
          disabled={clampedIndex === 0}
          aria-label="Previous word"
        >
          ◀
        </button>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minWidth: 'var(--cc-touch)', minHeight: 'var(--cc-touch)' }}
          onClick={goNext}
          disabled={clampedIndex === entries.length - 1}
          aria-label="Next word"
        >
          ▶
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', alignItems: 'center' }}>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minHeight: 'var(--cc-touch)', width: '100%' }}
          onClick={handleHear}
        >
          🔊 Hear it
        </button>
        <button
          type="button"
          className="cc-btn cc-btn-surface"
          style={{ minHeight: 'var(--cc-touch)', width: '100%' }}
          onClick={handleSayWithMe}
        >
          🗣️ Say it with me
        </button>
        <button type="button" className="ra-record-btn" onClick={handleTryIt} aria-label="Try it">
          <span style={{ fontSize: '2.2rem' }} aria-hidden="true">
            🎙️
          </span>
          <span style={{ fontSize: '1rem' }}>Try it</span>
        </button>
      </div>
    </div>
  )
}
