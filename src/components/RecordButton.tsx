export interface RecordButtonProps {
  state: 'idle' | 'starting' | 'recording'
  onStart: () => void
  onStop: () => void
  disabled?: boolean
}

/** The big round mic button on the Read screen: 🎙️ "Read it!" when idle, ⏹ "Stop" with a slow glow ring while recording. */
export function RecordButton({ state, onStart, onStop, disabled }: RecordButtonProps) {
  const recording = state === 'recording'
  const classes = ['ra-record-btn']
  if (recording) classes.push('ra-record-btn-recording')

  return (
    <button
      type="button"
      className={classes.join(' ')}
      disabled={disabled || state === 'starting'}
      onClick={recording ? onStop : onStart}
      aria-label={recording ? 'Stop' : 'Read it!'}
    >
      <span style={{ fontSize: '2.2rem' }} aria-hidden="true">
        {recording ? '⏹' : '🎙️'}
      </span>
      <span style={{ fontSize: '1rem' }}>{recording ? 'Stop' : 'Read it!'}</span>
    </button>
  )
}
