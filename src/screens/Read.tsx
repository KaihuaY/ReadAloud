import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { navigate, useRoute } from '../router'
import { useProgress } from '../store/progress'
import type { ReadingTake } from '../store/progress'
import { useReading } from '../store/reading'
import { useEarStage } from '../store/ear'
import { RECORD_LABELS, useRecordsBeaten } from '../store/records'
import { dismiss, startTake, stopTake, useRecordingSession } from '../audio/recordingSession'
import type { MicError } from '../audio/types'
import { isSpeechSupported, speakText, speakWord, cancelSpeech } from '../audio/speech'
import { passageById } from '../content/passages'
import { splitSentences } from '../content/textSplit'
import { formatClock } from '../store/sessions'
import { fireConfetti } from '../components/Confetti'
import { FocusWindow, PassageText } from '../components/FocusWindow'
import { RecordButton } from '../components/RecordButton'
import { StarBurst } from '../components/StarBurst'
import { RingTimer } from '../components/RingTimer'
import { LevelMeter } from '../components/LevelMeter'
import { CoachCard } from '../components/CoachCard'

const ERROR_MESSAGES: Record<MicError, string> = {
  denied:
    "I can't hear you yet. Ask a grown-up to turn on the microphone for this app: on iPad, tap the ᴬA button in Safari's address bar → Website Settings → Microphone → Allow (or Settings → Safari → Microphone).",
  unsupported: "This browser can't record. Try Safari or Chrome.",
  busy: 'Something is using the microphone. Close other apps and try again.',
  unknown: 'Something is using the microphone. Close other apps and try again.',
}

/** How long to wait for the ear before offering "I'll check it in a moment" instead of a spinner forever. */
const EAR_WAIT_TIMEOUT_MS = 45_000

const screenStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  padding: '1rem 1rem 2rem',
  alignItems: 'center',
  textAlign: 'center',
}

export function Read() {
  const { params } = useRoute()
  const passageId = params.passageId
  const progress = useProgress()
  const reading = useReading()
  const session = useRecordingSession()

  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [uiPhase, setUiPhase] = useState<'ready' | 'listening'>('ready')
  const [highlightCharIndex, setHighlightCharIndex] = useState<number | null>(null)
  const [listenedFirst, setListenedFirst] = useState(false)
  const [waitTimedOut, setWaitTimedOut] = useState(false)
  const [bestCelebrated, setBestCelebrated] = useState(false)

  const passage = passageById(passageId, progress.settings.customPassages)

  const cancelListenRef = useRef<() => void>(() => {})
  const listenFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The take just finished recording, if any - read the *live* copy from the
  // store (score/ai/waveform land asynchronously after the take is saved).
  const sessionTake = session.status === 'done' && !session.discarded ? session.take : null
  const liveTake: ReadingTake | null = sessionTake
    ? reading.takes.find((t) => t.id === sessionTake.id) ?? sessionTake
    : null
  const earStage = useEarStage(sessionTake?.id ?? '')
  const recordsBeaten = useRecordsBeaten(sessionTake?.id ?? '')

  // Always cancel any in-flight speech when this screen goes away.
  useEffect(() => {
    return () => cancelSpeech()
  }, [])

  // Drives "Listen first": speaks one sentence at a time, advancing
  // sentenceIndex on each onEnd, falling back to "highlight the whole
  // sentence" if no word-boundary event arrives within 700ms.
  useEffect(() => {
    if (uiPhase !== 'listening' || !passage) return
    const sentences = splitSentences(passage.text)
    const text = sentences[sentenceIndex]
    if (!text) {
      setUiPhase('ready')
      return
    }

    let boundaryFired = false
    listenFallbackTimerRef.current = setTimeout(() => {
      if (!boundaryFired) setHighlightCharIndex(-1)
    }, 700)

    const cancel = speakText(text, {
      rate: 0.9,
      onWordBoundary: (charIndex) => {
        boundaryFired = true
        if (listenFallbackTimerRef.current) {
          clearTimeout(listenFallbackTimerRef.current)
          listenFallbackTimerRef.current = null
        }
        setHighlightCharIndex(charIndex)
      },
      onEnd: () => {
        if (listenFallbackTimerRef.current) {
          clearTimeout(listenFallbackTimerRef.current)
          listenFallbackTimerRef.current = null
        }
        if (sentenceIndex + 1 < sentences.length) {
          setSentenceIndex(sentenceIndex + 1)
        } else {
          setListenedFirst(true)
          setHighlightCharIndex(null)
          setUiPhase('ready')
        }
      },
    })
    cancelListenRef.current = cancel

    return () => {
      cancel()
      if (listenFallbackTimerRef.current) {
        clearTimeout(listenFallbackTimerRef.current)
        listenFallbackTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase, sentenceIndex, passage?.id])

  // If the ear takes too long (or fails), stop showing a spinner forever.
  const liveTakeId = liveTake?.id
  const liveTakeHasScore = Boolean(liveTake?.score)
  useEffect(() => {
    if (!liveTakeId || liveTakeHasScore) {
      setWaitTimedOut(false)
      return
    }
    const timer = setTimeout(() => setWaitTimedOut(true), EAR_WAIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [liveTakeId, liveTakeHasScore])

  // Celebrate a new passage best exactly once per take.
  useEffect(() => {
    if (liveTake?.score?.newPassageBest && !bestCelebrated) {
      setBestCelebrated(true)
      fireConfetti()
    }
  }, [liveTake?.score?.newPassageBest, bestCelebrated])

  if (!passage) {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>That story wandered off. 📖</p>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={() => navigate('/library')}>
          ⬅ Back to books
        </button>
      </div>
    )
  }

  // A plain (never-reassigned) local so the nested tap handlers below can
  // close over a type that's definitely `ReadingPassage`, not the
  // `| undefined` TS otherwise keeps for anything captured across a
  // function boundary even after the guard above narrows `passage` itself.
  const currentPassage = passage

  function stopListening(): void {
    cancelListenRef.current()
    cancelSpeech()
    if (listenFallbackTimerRef.current) {
      clearTimeout(listenFallbackTimerRef.current)
      listenFallbackTimerRef.current = null
    }
    setHighlightCharIndex(null)
    setUiPhase('ready')
  }

  function handleListenFirst(): void {
    setSentenceIndex(0)
    setHighlightCharIndex(null)
    setUiPhase('listening')
  }

  function handleStartRecording(): void {
    // Must be called synchronously from this tap handler - Safari only
    // grants the mic prompt inside the gesture that requested it.
    cancelSpeech()
    setUiPhase('ready')
    void startTake(currentPassage.id, { listenedFirst })
  }

  function handleReadAgain(): void {
    dismiss()
    setSentenceIndex(0)
    setListenedFirst(false)
    setHighlightCharIndex(null)
    setUiPhase('ready')
  }

  function handleDoneFromResult(): void {
    dismiss()
    navigate('/library')
  }

  // --- Mic error ------------------------------------------------------
  if (session.status === 'error') {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>{ERROR_MESSAGES[session.error]}</p>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={handleStartRecording}>
          Try again
        </button>
      </div>
    )
  }

  // --- Mic warming up ---------------------------------------------------
  if (session.status === 'starting') {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>Getting ready to listen... 👂</p>
        <RecordButton state="starting" onStart={() => {}} onStop={() => {}} disabled />
      </div>
    )
  }

  // --- Recording ---------------------------------------------------------
  if (session.status === 'recording') {
    const sentences = splitSentences(passage.text)
    const maxSeconds = progress.settings.maxRecordSeconds
    const remaining = Math.max(0, maxSeconds - session.wallSec)
    const canAdvance = sentenceIndex + 1 < sentences.length

    function advance(): void {
      setSentenceIndex((i) => Math.min(i + 1, sentences.length - 1))
    }

    return (
      <div style={screenStyle}>
        <div onClick={advance} style={{ width: '100%', cursor: canAdvance ? 'pointer' : 'default' }}>
          <FocusWindow text={passage.text} sentenceIndex={sentenceIndex} onSentenceChange={setSentenceIndex} />
        </div>
        {canAdvance && (
          <button type="button" className="cc-btn cc-btn-surface" style={{ minHeight: 'var(--cc-touch)' }} onClick={advance}>
            Next ▶
          </button>
        )}
        <RingTimer
          size={120}
          progress={maxSeconds > 0 ? remaining / maxSeconds : 0}
          label={formatClock(Math.round(remaining))}
          sublabel="left"
        />
        <LevelMeter level={session.level} />
        <span style={{ fontWeight: 800, color: session.hearing ? 'var(--cc-success)' : 'var(--cc-ink-soft)' }}>
          {session.hearing ? '👂 I hear you' : 'Read nice and loud!'}
        </span>
        <RecordButton state="recording" onStart={() => {}} onStop={() => void stopTake('user')} />
      </div>
    )
  }

  // --- Saving --------------------------------------------------------------
  if (session.status === 'saving') {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>💾 Saving your reading...</p>
      </div>
    )
  }

  // --- Done: too short -----------------------------------------------------
  if (session.status === 'done' && session.discarded) {
    return (
      <div style={screenStyle}>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>That was very short. Try again when you&apos;re ready!</p>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={() => dismiss()}>
          Try again
        </button>
      </div>
    )
  }

  // --- Done: saved, waiting on / result from the ear ------------------------
  if (session.status === 'done' && liveTake) {
    const score = liveTake.score

    if (!score) {
      if (earStage === 'failed' || waitTimedOut) {
        return (
          <div style={screenStyle}>
            <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>Saved! ⭐ I&apos;ll check it in a moment</p>
            <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={handleDoneFromResult}>
              ✅ Done
            </button>
          </div>
        )
      }
      return (
        <div style={screenStyle}>
          <p className="cc-pulse" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
            Listening back... 👂
          </p>
        </div>
      )
    }

    if (score.outcome === 'noReading') {
      return (
        <div style={screenStyle}>
          <CoachCard take={liveTake} />
          <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96 }} onClick={() => dismiss()}>
            Try again
          </button>
        </div>
      )
    }

    const trickySet = new Set(score.trickyWords)

    return (
      <div style={screenStyle}>
        <StarBurst stars={score.stars} />
        <PassageText text={passage.text} trickyWords={trickySet} onWordTap={(token) => speakWord(token.display)} />
        {trickySet.size > 0 && (
          <p style={{ margin: 0, color: 'var(--cc-ink-soft)', fontSize: '0.95rem' }}>Tap a ☀️ word to hear it</p>
        )}
        {score.newPassageBest && (
          <p style={{ margin: 0, fontWeight: 800, color: 'var(--cc-primary)' }}>Smoother than last time! 🎉</p>
        )}
        {session.goalJustReached && (
          <p style={{ margin: 0, fontWeight: 800, color: 'var(--cc-accent)' }}>
            Reading goal done for today! 🥉 You earned a bronze token
          </p>
        )}
        {recordsBeaten.map((key) => (
          <p key={key} style={{ margin: 0, fontWeight: 800, color: 'var(--cc-primary)' }}>
            🏆 New record: {RECORD_LABELS[key].title.toLowerCase()}!
          </p>
        ))}
        <CoachCard take={liveTake} />
        <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
          <button type="button" className="cc-btn cc-btn-surface" style={{ minHeight: 96, flex: 1 }} onClick={handleReadAgain}>
            🔁 Read it again
          </button>
          <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 96, flex: 1 }} onClick={handleDoneFromResult}>
            ✅ Done
          </button>
        </div>
      </div>
    )
  }

  // --- Idle: "Listen first" ----------------------------------------------
  if (uiPhase === 'listening') {
    return (
      <div style={screenStyle}>
        <span style={{ fontSize: '2rem' }} aria-hidden="true">
          {passage.emoji}
        </span>
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{passage.title}</h1>
        <FocusWindow text={passage.text} sentenceIndex={sentenceIndex} highlightCharIndex={highlightCharIndex} />
        <button type="button" className="cc-btn cc-btn-surface" style={{ minHeight: 64 }} onClick={stopListening}>
          ⏹ Stop listening
        </button>
      </div>
    )
  }

  // --- Idle: ready to record -----------------------------------------------
  return (
    <div style={screenStyle}>
      <span style={{ fontSize: '2rem' }} aria-hidden="true">
        {passage.emoji}
      </span>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{passage.title}</h1>
      {passage.sourceNote && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>{passage.sourceNote}</p>
      )}
      <FocusWindow
        text={passage.text}
        sentenceIndex={sentenceIndex}
        onSentenceChange={setSentenceIndex}
        onWordTap={(token) => speakWord(token.display)}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', width: '100%' }}>
        {progress.settings.listenFirst && isSpeechSupported() && (
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ minHeight: 64, width: '100%' }}
            onClick={handleListenFirst}
          >
            🔊 Listen first
          </button>
        )}
        <RecordButton state="idle" onStart={handleStartRecording} onStop={() => {}} />
      </div>
    </div>
  )
}
