export interface SayItProps {
  text: string
  className?: string
  label?: string
}

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.95
    utterance.pitch = 1.1
    window.speechSynthesis.speak(utterance)
  } catch {
    // speechSynthesis can throw in some locked-down browser contexts; a
    // silent no-op is the right fallback for a "nice to have" button.
  }
}

/** A big speaker button that reads `text` aloud. No-op if speech isn't supported. */
export function SayIt({ text, className, label = 'Say it' }: SayItProps) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  if (!supported) return null

  return (
    <button
      type="button"
      className={`cc-btn cc-btn-surface ${className ?? ''}`}
      onClick={() => speak(text)}
      aria-label={`${label}: ${text}`}
    >
      <span aria-hidden="true">🔊</span>
      <span>{label}</span>
    </button>
  )
}
