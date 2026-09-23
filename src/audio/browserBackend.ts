// The real microphone backend: Web Audio (AnalyserNode) for the live level
// meter and MediaRecorder for the saved take. Every browser API call lives
// inside start()/stop(), never at module scope, so this file still imports
// cleanly in the node test environment (see recordingSession.ts, which picks
// FakeAudioBackend there instead).

import { pickRecordingMime } from './mime'
import { bandsFromSpectrum } from './spectrum'
import { MicStartError, type AudioBackend, type MicSession, type RecordingResult } from './types'

const LEVEL_INTERVAL_MS = 100
const FFT_SIZE = 2048

function errorName(err: unknown): string | undefined {
  if (err instanceof DOMException) return err.name
  if (err && typeof err === 'object' && 'name' in err) return String((err as { name: unknown }).name)
  return undefined
}

function mapError(err: unknown): MicStartError {
  const name = errorName(err)
  if (name === 'NotAllowedError' || name === 'SecurityError') return new MicStartError('denied')
  if (name === 'NotReadableError' || name === 'AbortError') return new MicStartError('busy')
  return new MicStartError('unknown')
}

function resolveAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

class BrowserMicSession implements MicSession {
  readonly mimeType: string
  private readonly ctx: AudioContext
  private readonly stream: MediaStream
  private readonly analyser: AnalyserNode
  private readonly recorder: MediaRecorder
  private readonly chunks: BlobPart[] = []
  private readonly buffer: Float32Array<ArrayBuffer>
  private readonly spectrumBytes: Uint8Array<ArrayBuffer>
  private readonly listeners = new Set<(rms: number, t: number) => void>()
  private readonly spectrumListeners = new Set<(bands: Float32Array, t: number) => void>()
  private readonly chunkListeners = new Set<(blob: Blob, seq: number) => void>()
  private readonly createdAt: number
  private levelTimer: ReturnType<typeof setInterval> | null
  private stopped = false
  private chunkSeq = 0

  constructor(ctx: AudioContext, stream: MediaStream, analyser: AnalyserNode, recorder: MediaRecorder, mimeType: string) {
    this.ctx = ctx
    this.stream = stream
    this.analyser = analyser
    this.recorder = recorder
    this.mimeType = mimeType
    this.buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT))
    this.spectrumBytes = new Uint8Array(analyser.frequencyBinCount)
    this.createdAt = performance.now()

    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data)
        const seq = this.chunkSeq++
        for (const listener of this.chunkListeners) listener(e.data, seq)
      }
    }

    this.levelTimer = setInterval(() => this.sample(), LEVEL_INTERVAL_MS)
  }

  private sample(): void {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sumSquares = 0
    for (let i = 0; i < this.buffer.length; i++) sumSquares += this.buffer[i] * this.buffer[i]
    const rms = Math.sqrt(sumSquares / this.buffer.length)
    const t = performance.now()
    for (const listener of this.listeners) listener(rms, t)

    if (this.spectrumListeners.size > 0) {
      this.analyser.getByteFrequencyData(this.spectrumBytes)
      const bands = bandsFromSpectrum(this.spectrumBytes, this.ctx.sampleRate, this.analyser.fftSize)
      for (const listener of this.spectrumListeners) listener(bands, t)
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
    if (this.stopped) {
      return { blob: null, mimeType: this.mimeType, durationMs: 0 }
    }
    this.stopped = true
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer)
      this.levelTimer = null
    }

    const stopPromise = new Promise<void>((resolve) => {
      this.recorder.onstop = () => resolve()
    })
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop()
    } else {
      // Already inactive (e.g. the track died underneath us) - nothing will
      // ever fire onstop, so resolve the wait manually.
      this.recorder.onstop = null
    }
    if (this.recorder.state !== 'inactive') await stopPromise

    for (const track of this.stream.getTracks()) track.stop()
    try {
      await this.ctx.close()
    } catch {
      // Already closed - fine.
    }

    const mimeType = this.recorder.mimeType || this.mimeType
    const blob = this.chunks.length > 0 ? new Blob(this.chunks, { type: mimeType }) : null
    const durationMs = performance.now() - this.createdAt
    return { blob, mimeType, durationMs }
  }
}

export class BrowserAudioBackend implements AudioBackend {
  isSupported(): boolean {
    if (typeof navigator === 'undefined') return false
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return false
    if (typeof MediaRecorder === 'undefined') return false
    return true
  }

  async start(opts?: { audioBitsPerSecond?: number }): Promise<MicSession> {
    if (!this.isSupported()) throw new MicStartError('unsupported')

    const AudioContextCtor = resolveAudioContextCtor()
    if (!AudioContextCtor) throw new MicStartError('unsupported')

    // Created synchronously, before any await, so Safari still treats this
    // as inside the user gesture that triggered start().
    let ctx = new AudioContextCtor()
    try {
      await ctx.resume()
    } catch {
      // Some browsers reject resume() before layout settles; getUserMedia
      // below still works and the context resumes once audio actually flows.
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (err) {
      await ctx.close().catch(() => {})
      throw mapError(err)
    }

    let source: MediaStreamAudioSourceNode
    try {
      source = ctx.createMediaStreamSource(stream)
    } catch {
      // Safari sometimes throws when the context's sample rate doesn't
      // match the track's; recreate the context at the track's own sample
      // rate and retry exactly once.
      const track = stream.getAudioTracks()[0]
      const sampleRate = track?.getSettings().sampleRate
      await ctx.close().catch(() => {})
      ctx = sampleRate ? new AudioContextCtor({ sampleRate }) : new AudioContextCtor()
      try {
        await ctx.resume()
      } catch {
        // As above - non-fatal.
      }
      try {
        source = ctx.createMediaStreamSource(stream)
      } catch (err) {
        for (const t of stream.getTracks()) t.stop()
        await ctx.close().catch(() => {})
        throw mapError(err)
      }
    }

    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    source.connect(analyser)

    const mime = pickRecordingMime() ?? undefined
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: opts?.audioBitsPerSecond ?? 48000,
      })
    } catch (err) {
      for (const t of stream.getTracks()) t.stop()
      await ctx.close().catch(() => {})
      throw mapError(err)
    }

    const session = new BrowserMicSession(ctx, stream, analyser, recorder, mime ?? recorder.mimeType ?? '')
    recorder.start(1000)
    return session
  }
}
