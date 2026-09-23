// A scripted AudioBackend for laptop development (enabled via ?fakeMic=1 in
// dev) and for tests that need to exercise ActivityMeter / recording flows
// without a real microphone. Emits RMS levels on a timer from either a fixed
// script of { rms, ms } segments or an arbitrary function of elapsed time.

import type { AudioBackend, MicSession, RecordingResult } from './types'

export type FakeScript = Array<{ rms: number; ms: number }> | ((elapsedMs: number) => number)

const SPECTRUM_BAND_COUNT = 24
const ATTACK_WINDOW_MS = 120
const ATTACK_MULTIPLIER = 6

/** How far (ms) `elapsedMs` is into whichever script segment it currently falls in - 0 right at that segment's start. */
function segmentElapsedMs(script: FakeScript, elapsedMs: number): number {
  if (typeof script === 'function' || script.length === 0) return Infinity // no discrete segments to attack-bump
  let acc = 0
  for (const segment of script) {
    if (elapsedMs < acc + segment.ms) return elapsedMs - acc
    acc += segment.ms
  }
  return Infinity // past the end of the script - no more segment boundaries
}

/**
 * A synthetic 24-band "spectrum" for the fake backend, so the aurora has
 * something lively to draw during laptop development / headless tests: a
 * Gaussian hump whose centre band wanders slowly over time and whose height
 * tracks the scripted RMS, plus a little noise so it never looks static. A
 * short transient boost right at the start of each script segment (a "note
 * attack") makes the recordingSession's OnsetDetector reliably fire once per
 * segment regardless of how much its envelope has decayed since the last
 * one - without it, a still-elevated envelope can occasionally swallow the
 * next segment's onset (see recordingSession's steady-beat readout).
 */
function fakeBands(rms: number, elapsedMs: number, script: FakeScript): Float32Array {
  const bands = new Float32Array(SPECTRUM_BAND_COUNT)
  // Kept comfortably inside [0, SPECTRUM_BAND_COUNT) rather than wandering
  // to the edges: a centre near either edge clips most of the Gaussian
  // hump's mass out of the array, which used to quietly starve the mean
  // energy at whatever moment the onset detector needed it most.
  const center = SPECTRUM_BAND_COUNT / 2 + 5 * Math.sin(elapsedMs / 900)
  const intoSegment = segmentElapsedMs(script, elapsedMs)
  const attack = intoSegment < ATTACK_WINDOW_MS ? rms * ATTACK_MULTIPLIER * (1 - intoSegment / ATTACK_WINDOW_MS) : 0
  const height = Math.min(1, rms * 3 + attack)
  for (let i = 0; i < SPECTRUM_BAND_COUNT; i++) {
    const d = i - center
    const hump = Math.exp(-(d * d) / (2 * 3 * 3)) * height
    const noise = Math.random() * 0.04
    bands[i] = Math.max(0, Math.min(1, hump + noise))
  }
  return bands
}

export interface FakeAudioBackendOptions {
  tickMs?: number
  mimeType?: string
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function rmsForElapsed(script: FakeScript, elapsedMs: number): number {
  if (typeof script === 'function') return script(elapsedMs)
  if (script.length === 0) return 0
  let acc = 0
  for (const segment of script) {
    if (elapsedMs < acc + segment.ms) return segment.rms
    acc += segment.ms
  }
  // Past the end of the script: hold the last segment's level.
  return script[script.length - 1].rms
}

const WAV_SAMPLE_RATE = 8000
const WAV_MAX_SECONDS = 120

/**
 * A genuine, decodable 16-bit PCM WAV blob - amplitude-modulated to loosely
 * track the script's rms envelope, so a fake take actually plays back (real
 * duration, waveform, aurora analyser) instead of being an opaque stub.
 * Real recordings never take this path (see BrowserAudioBackend); this only
 * feeds the dev `?fakeMic=1` backend and tests.
 */
function synthesizeWavBlob(script: FakeScript, durationMs: number, mimeType: string): Blob {
  const seconds = Math.max(0.5, Math.min(WAV_MAX_SECONDS, durationMs / 1000))
  const sampleCount = Math.round(seconds * WAV_SAMPLE_RATE)
  const pcm = new Int16Array(sampleCount)
  let phase = 0
  for (let i = 0; i < sampleCount; i++) {
    const tMs = (i / WAV_SAMPLE_RATE) * 1000
    const envelope = Math.min(1, rmsForElapsed(script, tMs) * 3)
    // A slowly wandering tone rather than one fixed frequency, so the
    // decoded waveform has some texture instead of reading perfectly flat.
    const freq = 220 + 80 * Math.sin(tMs / 1300)
    phase += (2 * Math.PI * freq) / WAV_SAMPLE_RATE
    const sample = Math.sin(phase) * envelope
    pcm[i] = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)))
  }

  const headerSize = 44
  const dataSize = pcm.length * 2
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)
  function writeString(offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, WAV_SAMPLE_RATE, true)
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)
  new Int16Array(buffer, headerSize).set(pcm)

  return new Blob([buffer], { type: mimeType })
}

class FakeMicSession implements MicSession {
  readonly mimeType: string
  private readonly script: FakeScript
  private readonly startedAt: number
  private readonly listeners = new Set<(rms: number, t: number) => void>()
  private readonly spectrumListeners = new Set<(bands: Float32Array, t: number) => void>()
  private readonly chunkListeners = new Set<(blob: Blob, seq: number) => void>()
  private timer: ReturnType<typeof setInterval> | null
  private chunkSeq = 0

  constructor(script: FakeScript, mimeType: string, tickMs: number) {
    this.script = script
    this.mimeType = mimeType
    this.startedAt = now()
    this.timer = setInterval(() => this.tick(), tickMs)
  }

  private tick(): void {
    const t = now()
    const elapsed = t - this.startedAt
    const rms = rmsForElapsed(this.script, elapsed)
    for (const listener of this.listeners) listener(rms, t)
    if (this.spectrumListeners.size > 0) {
      const bands = fakeBands(rms, elapsed, this.script)
      for (const listener of this.spectrumListeners) listener(bands, t)
    }
    // A tiny fake chunk per tick, same shape as the real backend's
    // ondataavailable slices - lets tests exercise the partial-recording
    // pipeline (recordingSession.ts) without a real MediaRecorder.
    if (this.chunkListeners.size > 0) {
      const seq = this.chunkSeq++
      const blob = new Blob([new Uint8Array(16)], { type: this.mimeType })
      for (const listener of this.chunkListeners) listener(blob, seq)
    }
  }

  onLevel(cb: (rms: number, t: number) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onSpectrum(cb: (bands: Float32Array, t: number) => void): () => void {
    this.spectrumListeners.add(cb)
    return () => this.spectrumListeners.delete(cb)
  }

  onChunk(cb: (blob: Blob, seq: number) => void): () => void {
    this.chunkListeners.add(cb)
    return () => this.chunkListeners.delete(cb)
  }

  async stop(): Promise<RecordingResult> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    const durationMs = now() - this.startedAt
    return {
      blob: synthesizeWavBlob(this.script, durationMs, this.mimeType),
      mimeType: this.mimeType,
      durationMs,
    }
  }
}

export class FakeAudioBackend implements AudioBackend {
  private readonly script: FakeScript
  private readonly opts: FakeAudioBackendOptions | undefined

  constructor(script: FakeScript, opts?: FakeAudioBackendOptions) {
    this.script = script
    this.opts = opts
  }

  isSupported(): boolean {
    return true
  }

  async start(): Promise<MicSession> {
    const tickMs = this.opts?.tickMs ?? 100
    const mimeType = this.opts?.mimeType ?? 'audio/wav'
    return new FakeMicSession(this.script, mimeType, tickMs)
  }
}

// 3 s of quiet room noise, then 40 s of alternating notes/rests that look
// like real piano playing, then 25 s of quiet - long enough to demo the
// ring filling, the goal being reached, and the "keep playing" hint on a
// laptop with no microphone.
export const FAKE_PIANO_SCRIPT: Array<{ rms: number; ms: number }> = [
  { rms: 0.004, ms: 3000 },
  ...Array.from({ length: 20 }, () => [
    { rms: 0.3, ms: 1200 },
    { rms: 0.01, ms: 800 },
  ]).flat(),
  { rms: 0.005, ms: 25000 },
]
