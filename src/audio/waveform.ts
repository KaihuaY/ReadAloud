// Turns a recorded take's audio into a small "waveform" - peak amplitude per
// bucket, scaled 0-100 - cheap enough to store on the take (see
// PianoTake.waveform in src/store/progress.ts) and draw under the player
// (src/components/WaveformBar.tsx) without re-decoding the whole file every
// time.

/**
 * Peak |amplitude| per bucket across `samples` (a single audio channel),
 * scaled so the loudest bucket reads 100 and every value is an integer.
 * Pure and synchronous so it's trivial to unit test; `computeWaveform` below
 * is the only caller that has to deal with decoding actual audio.
 */
export function bucketize(samples: Float32Array | number[], buckets = 160): number[] {
  const n = samples.length
  if (n === 0 || buckets <= 0) return new Array(Math.max(0, buckets)).fill(0)

  const peaks = new Array<number>(buckets).fill(0)
  const perBucket = n / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * perBucket)
    const end = b === buckets - 1 ? n : Math.floor((b + 1) * perBucket)
    let peak = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > peak) peak = v
    }
    peaks[b] = peak
  }

  const loudest = Math.max(...peaks, 0)
  if (loudest === 0) return peaks.map(() => 0)
  return peaks.map((p) => Math.round((p / loudest) * 100))
}

type AudioContextCtor = new () => AudioContext

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * Decodes `blob` (a recorded take's audio) and buckets its first channel
 * into a waveform for storage/display. Browser-only; resolves `null` on any
 * failure (unsupported format, no AudioContext, a decode error) rather than
 * throwing, so callers can always fall back to a plain seek bar. Always
 * closes the AudioContext it opens.
 */
export async function computeWaveform(blob: Blob, buckets = 160): Promise<number[] | null> {
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null

  let ctx: AudioContext | null = null
  try {
    ctx = new Ctor()
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    const channel = audioBuffer.getChannelData(0)
    return bucketize(channel, buckets)
  } catch {
    return null
  } finally {
    if (ctx) {
      try {
        await ctx.close()
      } catch {
        // Nothing more useful to do if closing fails.
      }
    }
  }
}
