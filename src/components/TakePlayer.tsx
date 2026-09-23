import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { ReadingTake } from '../store/progress'
import { setTakeWaveform } from '../store/reading'
import { getRecordingStore, useLocalAudioIds } from '../store/recordings'
import { formatClock } from '../store/sessions'
import { computeWaveform } from '../audio/waveform'
import { WaveformBar } from './WaveformBar'

const bigButtonStyle = {
  width: 72,
  height: 72,
  borderRadius: '50%',
  background: 'var(--cc-primary)',
  color: '#fff',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.8rem',
  lineHeight: 1,
  flexShrink: 0,
  cursor: 'pointer',
  padding: 0,
} as const

/**
 * The actual playback UI, once we have a URL to play (a local blob's object
 * URL, or a Drive URL) - a big round play/pause button plus either a
 * waveform strip (when the take has one - see src/audio/waveform.ts) or a
 * thick seek bar, both driven off a hidden <audio> element via React state
 * rather than the tiny native controls. Callers key this by `src` so a
 * different take's audio always mounts a fresh instance instead of this one
 * trying to reset its own playing/currentTime/duration state mid-life.
 */
function BigPlayer({
  src,
  fallbackDurationSec,
  waveform,
}: {
  src: string
  fallbackDurationSec: number
  waveform?: number[]
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(fallbackDurationSec)
  const [error, setError] = useState(false)

  function handleLoadedMetadata() {
    const audio = audioRef.current
    if (!audio) return
    // Some WebM recordings report an Infinity duration until more of the
    // file has been read - fall back to what we already know from the take.
    setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDurationSec)
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (audio) setCurrentTime(audio.currentTime)
  }

  function handleEnded() {
    setPlaying(false)
    setCurrentTime(0)
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setError(true))
  }

  function handleSeek(e: ChangeEvent<HTMLInputElement>) {
    const next = Number(e.target.value)
    setCurrentTime(next)
    if (audioRef.current) audioRef.current.currentTime = next
  }

  function handleSeekFraction(fraction: number) {
    const next = Math.max(0, Math.min(1, fraction)) * (duration || 0)
    setCurrentTime(next)
    if (audioRef.current) audioRef.current.currentTime = next
  }

  if (error) {
    return <p style={{ margin: 0, color: 'var(--cc-danger)', fontWeight: 700 }}>Can&apos;t play this one. 😕</p>
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
      <audio
        ref={audioRef}
        src={src}
        playsInline
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={() => setError(true)}
        style={{ display: 'none' }}
      />
      <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} style={bigButtonStyle}>
        {playing ? '⏸' : '▶'}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {waveform && waveform.length > 0 ? (
          <WaveformBar waveform={waveform} progress={progress} onSeek={handleSeekFraction} />
        ) : (
          <input
            type="range"
            className="cc-seek"
            min={0}
            max={duration || 0.01}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={handleSeek}
            aria-label="Seek"
            style={
              {
                '--cc-seek-fill': `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
              } as CSSProperties
            }
          />
        )}
        <span style={{ fontSize: '0.8rem', color: 'var(--cc-ink-soft)', fontWeight: 700 }}>
          {formatClock(Math.round(currentTime))} / {formatClock(Math.round(duration))}
        </span>
      </div>
    </div>
  )
}

/**
 * Plays back one reading take, wherever its audio lives: a local blob on
 * this device (lazily loaded as an object URL on first tap, revoked on
 * unmount), or the parent's Google Drive copy when this device never
 * recorded it. A take recorded before waveforms existed (or one whose
 * earlier compute failed) gets one computed lazily here, once, from the
 * local blob, and written back onto the take so every screen picks it up on
 * the next render.
 */
export function TakePlayer({ take }: { take: ReadingTake }) {
  const localAudioIds = useLocalAudioIds()
  const isLocal = localAudioIds.has(take.id)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const waveformRequestedRef = useRef(false)

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  async function handleListen() {
    if (objectUrl || loadingAudio) return
    setLoadingAudio(true)
    setLoadError(false)
    try {
      const blob = await getRecordingStore().get(take.id)
      if (blob) {
        setObjectUrl(URL.createObjectURL(blob))
        if (!take.waveform && !waveformRequestedRef.current) {
          waveformRequestedRef.current = true
          void computeWaveform(blob).then((waveform) => {
            if (waveform) setTakeWaveform(take.id, waveform)
          })
        }
      } else {
        setLoadError(true)
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoadingAudio(false)
    }
  }

  if (isLocal) {
    if (objectUrl) {
      return <BigPlayer key={objectUrl} src={objectUrl} fallbackDurationSec={take.durationSec} waveform={take.waveform} />
    }
    if (loadingAudio) {
      return <p style={{ margin: 0, fontWeight: 700, color: 'var(--cc-ink-soft)' }}>Getting the recording… 🎵</p>
    }
    if (loadError) {
      return <p style={{ margin: 0, color: 'var(--cc-danger)', fontWeight: 700 }}>Can&apos;t play this one. 😕</p>
    }
    return (
      <button type="button" onClick={() => void handleListen()} aria-label="Play" style={bigButtonStyle}>
        ▶
      </button>
    )
  }

  if (take.upload?.driveUrl) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <BigPlayer key={take.upload.driveUrl} src={take.upload.driveUrl} fallbackDurationSec={take.durationSec} waveform={take.waveform} />
        {take.upload.driveFileId && (
          <a
            href={`https://drive.google.com/file/d/${take.upload.driveFileId}/view`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.85rem' }}
          >
            Open in Drive ↗
          </a>
        )}
      </div>
    )
  }

  return <span style={{ color: 'var(--cc-ink-soft)', fontSize: '0.85rem' }}>Recorded on another device (not uploaded yet)</span>
}
