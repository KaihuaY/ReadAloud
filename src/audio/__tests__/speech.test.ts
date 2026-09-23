import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelSpeech, pickVoice, speakText, speakWord, isSpeechSupported } from '../speech'

// A minimal stand-in for SpeechSynthesisUtterance: just enough state and
// event hooks for speech.ts to drive, captured by the fake synth's speak().
class FakeUtterance {
  text: string
  rate = 1
  voice: unknown = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  onboundary: ((e: { name?: string; charIndex: number }) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

interface FakeVoice {
  name: string
  lang: string
}

let capturedUtterance: FakeUtterance | null = null
let fakeSynth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> } | null = null

function installFakeSynth(voices: FakeVoice[]): void {
  capturedUtterance = null
  fakeSynth = {
    speak: vi.fn((u: FakeUtterance) => {
      capturedUtterance = u
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn(),
  }
  Object.defineProperty(globalThis, 'speechSynthesis', { value: fakeSynth, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true })
}

function uninstallFakeSynth(): void {
  const g = globalThis as Record<string, unknown>
  delete g.speechSynthesis
  delete g.SpeechSynthesisUtterance
  fakeSynth = null
  capturedUtterance = null
}

describe('speech - no speechSynthesis available (SSR / node / old browsers)', () => {
  it('isSpeechSupported is false', () => {
    expect(isSpeechSupported()).toBe(false)
  })

  it('pickVoice is null', () => {
    expect(pickVoice()).toBeNull()
  })

  it('speakText still calls onEnd and returns a harmless cancel function', () => {
    const onEnd = vi.fn()
    const cancel = speakText('hello there', { onEnd })
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(() => cancel()).not.toThrow()
  })

  it('speakWord still calls onEnd and returns a harmless cancel function', () => {
    const onEnd = vi.fn()
    const cancel = speakWord('cat', { onEnd })
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(() => cancel()).not.toThrow()
  })

  it('cancelSpeech never throws', () => {
    expect(() => cancelSpeech()).not.toThrow()
  })
})

describe('speech - with a fake speechSynthesis', () => {
  afterEach(() => {
    uninstallFakeSynth()
  })

  it('cancels anything speaking first, speaks at the default rate 0.9, and forwards word-boundary charIndex', () => {
    installFakeSynth([{ name: 'Karen', lang: 'en-US' }])
    const onStart = vi.fn()
    const onWordBoundary = vi.fn()
    const onEnd = vi.fn()

    speakText('the cat sat', { onStart, onWordBoundary, onEnd })

    expect(fakeSynth!.cancel).toHaveBeenCalledTimes(1)
    expect(fakeSynth!.speak).toHaveBeenCalledTimes(1)
    expect(capturedUtterance).not.toBeNull()
    expect(capturedUtterance!.rate).toBe(0.9)

    capturedUtterance!.onstart?.()
    expect(onStart).toHaveBeenCalledTimes(1)

    capturedUtterance!.onboundary?.({ name: 'word', charIndex: 4 })
    expect(onWordBoundary).toHaveBeenCalledWith(4)

    // Some engines (notably iOS Safari) never set `name` at all - still a word boundary.
    capturedUtterance!.onboundary?.({ charIndex: 8 })
    expect(onWordBoundary).toHaveBeenCalledWith(8)

    // A boundary of a different kind must not be forwarded as a word boundary.
    capturedUtterance!.onboundary?.({ name: 'sentence', charIndex: 99 })
    expect(onWordBoundary).not.toHaveBeenCalledWith(99)

    expect(onEnd).not.toHaveBeenCalled()
    capturedUtterance!.onend?.()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('calls onEnd on onerror too', () => {
    installFakeSynth([{ name: 'Karen', lang: 'en-US' }])
    const onEnd = vi.fn()
    speakText('oops', { onEnd })
    capturedUtterance!.onerror?.()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('only calls onEnd once even if both onend and onerror somehow fire', () => {
    installFakeSynth([{ name: 'Karen', lang: 'en-US' }])
    const onEnd = vi.fn()
    speakText('oops', { onEnd })
    capturedUtterance!.onend?.()
    capturedUtterance!.onerror?.()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('a returned cancel function calls speechSynthesis.cancel()', () => {
    installFakeSynth([{ name: 'Karen', lang: 'en-US' }])
    const cancel = speakText('hi')
    fakeSynth!.cancel.mockClear()
    cancel()
    expect(fakeSynth!.cancel).toHaveBeenCalledTimes(1)
  })

  it('speakWord uses a slower default rate (0.75)', () => {
    installFakeSynth([{ name: 'Karen', lang: 'en-US' }])
    speakWord('cat')
    expect(capturedUtterance!.rate).toBe(0.75)
  })

  it('an explicit rate overrides the default for both speakText and speakWord', () => {
    installFakeSynth([{ name: 'Karen', lang: 'en-US' }])
    speakText('slow down', { rate: 0.5 })
    expect(capturedUtterance!.rate).toBe(0.5)

    speakWord('cat', { rate: 1 })
    expect(capturedUtterance!.rate).toBe(1)
  })

  describe('pickVoice preference order', () => {
    it('prefers a preferred-name match over voice list order', () => {
      installFakeSynth([
        { name: 'Alex', lang: 'en-US' },
        { name: 'Karen', lang: 'en-AU' },
      ])
      expect(pickVoice()?.name).toBe('Karen')
    })

    it('checks preferred names in priority order (Samantha before Karen)', () => {
      installFakeSynth([
        { name: 'Karen', lang: 'en-AU' },
        { name: 'Samantha', lang: 'en-US' },
      ])
      expect(pickVoice()?.name).toBe('Samantha')
    })

    it('matches a preferred name case-insensitively, as a substring', () => {
      installFakeSynth([
        { name: 'Google US English', lang: 'en-US' },
        { name: 'Zzz', lang: 'en-GB' },
      ])
      expect(pickVoice()?.name).toBe('Google US English')
    })

    it('falls back to the first en voice when no preferred name matches', () => {
      installFakeSynth([
        { name: 'Alex', lang: 'en-US' },
        { name: 'Amelie', lang: 'fr-FR' },
      ])
      expect(pickVoice()?.name).toBe('Alex')
    })

    it('is null when there is no en voice at all', () => {
      installFakeSynth([{ name: 'Amelie', lang: 'fr-FR' }])
      expect(pickVoice()).toBeNull()
    })

    it('is null when there are no voices at all', () => {
      installFakeSynth([])
      expect(pickVoice()).toBeNull()
    })
  })
})
