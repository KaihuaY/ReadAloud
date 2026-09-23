// Browser text-to-speech wrapper for Read Aloud's "Listen first" and 🔊
// SayIt buttons. Every export is a safe no-op (returns false/null, or a
// harmless cancel function) when the Web Speech API isn't available - SSR,
// Vitest (node environment), and older browsers all take this path, same
// pattern as audio/browserBackend.ts's `typeof MediaRecorder === 'undefined'`
// guards.

function getSynth(): SpeechSynthesis | null {
  try {
    if (typeof speechSynthesis === 'undefined') return null
    return speechSynthesis
  } catch {
    return null
  }
}

export function isSpeechSupported(): boolean {
  return getSynth() !== null
}

/** Preferred voice names, checked in order, matched case-insensitively as a substring. */
const PREFERRED_VOICE_NAMES = ['samantha', 'karen', 'moira', 'google us english', 'microsoft aria']

let cachedVoices: SpeechSynthesisVoice[] = []
let voicesListenerAttached = false

function refreshVoices(synth: SpeechSynthesis): void {
  try {
    cachedVoices = synth.getVoices?.() ?? []
  } catch {
    cachedVoices = []
  }
}

function ensureVoicesListener(synth: SpeechSynthesis): void {
  refreshVoices(synth)
  if (voicesListenerAttached) return
  voicesListenerAttached = true
  try {
    synth.addEventListener('voiceschanged', () => refreshVoices(synth))
  } catch {
    // Some engines only support the onvoiceschanged property, not addEventListener.
    try {
      synth.onvoiceschanged = () => refreshVoices(synth)
    } catch {
      // No voice list refresh available - pickVoice() just uses whatever getVoices() returns each call.
    }
  }
}

/** Prefers a warm en voice by name; else the first 'en' voice; else null. Refreshes its cache on 'voiceschanged'. */
export function pickVoice(): SpeechSynthesisVoice | null {
  const synth = getSynth()
  if (!synth) return null
  ensureVoicesListener(synth)

  const voices = cachedVoices.length > 0 ? cachedVoices : synth.getVoices?.() ?? []
  if (voices.length === 0) return null

  for (const preferred of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name.toLowerCase().includes(preferred))
    if (match) return match
  }
  const firstEn = voices.find((v) => v.lang?.toLowerCase().startsWith('en'))
  return firstEn ?? null
}

export interface SpeakOptions {
  rate?: number
  onWordBoundary?: (charIndex: number) => void
  onEnd?: () => void
  onStart?: () => void
}

export function cancelSpeech(): void {
  const synth = getSynth()
  if (!synth) return
  try {
    synth.cancel()
  } catch {
    // No-op - nothing was speaking, or the engine doesn't support cancel mid-utterance.
  }
}

function speak(
  text: string,
  rate: number,
  opts: { onWordBoundary?: (charIndex: number) => void; onEnd?: () => void; onStart?: () => void },
): () => void {
  const synth = getSynth()
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    opts.onEnd?.()
    return () => {}
  }

  // Cancel anything already speaking first, so two taps never overlap.
  cancelSpeech()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  const voice = pickVoice()
  if (voice) utterance.voice = voice

  let ended = false
  const finish = () => {
    if (ended) return
    ended = true
    opts.onEnd?.()
  }

  utterance.onstart = () => opts.onStart?.()
  utterance.onboundary = (e: SpeechSynthesisEvent) => {
    if (e.name === 'word' || e.name === undefined) opts.onWordBoundary?.(e.charIndex)
  }
  utterance.onend = finish
  utterance.onerror = finish

  try {
    synth.speak(utterance)
  } catch {
    finish()
  }

  return () => {
    try {
      synth.cancel()
    } catch {
      // No-op.
    }
  }
}

/** Speaks a sentence/passage at a natural pace (default rate 0.9), reporting word-boundary char offsets. Cancels anything already speaking. Returns a cancel function. */
export function speakText(text: string, opts: SpeakOptions = {}): () => void {
  return speak(text, opts.rate ?? 0.9, opts)
}

/** Speaks a single word slower (default rate 0.75), for "Say it with me" taps. */
export function speakWord(word: string, opts: { rate?: number; onEnd?: () => void } = {}): () => void {
  return speak(word, opts.rate ?? 0.75, { onEnd: opts.onEnd })
}
