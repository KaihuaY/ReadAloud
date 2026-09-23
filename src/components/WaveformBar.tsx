import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const HEIGHT = 56
const MIN_BAR_HEIGHT = 3
const SEEK_STEP = 0.05

/** Quiet blue -> loud pink, matching the live Aurora's hue ramp. */
function barColor(amplitude: number): string {
  const hue = 205 + Math.max(0, Math.min(100, amplitude)) * 1.4
  return `hsl(${hue} 90% 58%)`
}

/**
 * A tappable/draggable waveform strip: 160 rounded bars scaled by peak
 * amplitude, the played portion in full colour and the rest dimmed, with a
 * thin playhead line. Replaces the plain range slider inside TakePlayer's
 * BigPlayer whenever a take has a stored `waveform` (see
 * src/audio/waveform.ts). The whole strip is one 56px-tall touch target -
 * pointer down/drag seeks, and it's a real slider for keyboard/AT users.
 */
export function WaveformBar({
  waveform,
  progress,
  onSeek,
}: {
  waveform: number[]
  progress: number
  onSeek: (fraction: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const clampedProgress = Math.max(0, Math.min(1, progress))

  function fractionFromClientX(clientX: number): number {
    const el = containerRef.current
    if (!el) return clampedProgress
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return clampedProgress
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(fractionFromClientX(e.clientX))
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons === 0) return
    onSeek(fractionFromClientX(e.clientX))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onSeek(Math.max(0, clampedProgress - SEEK_STEP))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onSeek(Math.min(1, clampedProgress + SEEK_STEP))
    }
  }

  const barCount = waveform.length
  const playedBars = Math.round(clampedProgress * barCount)

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedProgress * 100)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        width: '100%',
        height: HEIGHT,
        cursor: 'pointer',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {waveform.map((amplitude, i) => {
        const played = i < playedBars
        const barHeight = Math.max(MIN_BAR_HEIGHT, (Math.max(0, Math.min(100, amplitude)) / 100) * HEIGHT)
        return (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 1,
              height: barHeight,
              borderRadius: '2px 2px 0 0',
              background: barColor(amplitude),
              opacity: played ? 1 : 0.35,
              pointerEvents: 'none',
            }}
          />
        )
      })}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: `${clampedProgress * 100}%`,
          top: 0,
          bottom: 0,
          width: 2,
          background: 'var(--cc-ink)',
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
