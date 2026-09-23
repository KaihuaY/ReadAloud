// Pure signal-processing helpers for the piano "aurora" visualizer: turning
// an AnalyserNode's raw frequency-domain bytes into a small number of
// log-spaced loudness bands (piano notes span octaves, which are logarithmic
// in frequency, so linear FFT bins would crowd all the interesting activity
// into a handful of low bands), plus a simple onset detector so the aurora
// can spawn a note bubble exactly when a new note starts rather than once
// per sample while a note rings on.

const MIN_HZ = 60
const MAX_HZ = 6000

/**
 * Reduces `bytes` (an AnalyserNode.getByteFrequencyData() snapshot, 0..255
 * per bin) into `bandCount` log-spaced loudness bands between 60 Hz and
 * 6 kHz, each 0..1. Bands are the mean of every FFT bin whose frequency
 * falls in that band's [low, high) range, divided by 255. A band with no
 * bins in range (narrow low bands can fall entirely between two coarse FFT
 * bins) reuses the single nearest bin instead of reading as silent.
 */
export function bandsFromSpectrum(
  bytes: Uint8Array,
  sampleRate: number,
  fftSize: number,
  bandCount = 24,
): Float32Array {
  const nBins = bytes.length
  const out = new Float32Array(bandCount)
  if (nBins === 0 || bandCount <= 0) return out

  const binHz = (i: number): number => (i * sampleRate) / fftSize
  const ratio = Math.pow(MAX_HZ / MIN_HZ, 1 / bandCount)
  const edges = new Float32Array(bandCount + 1)
  for (let k = 0; k <= bandCount; k++) edges[k] = MIN_HZ * Math.pow(ratio, k)

  for (let b = 0; b < bandCount; b++) {
    const lo = edges[b]
    const hi = edges[b + 1]
    let sum = 0
    let count = 0
    for (let j = 0; j < nBins; j++) {
      const f = binHz(j)
      const inBand = b === bandCount - 1 ? f >= lo && f <= hi : f >= lo && f < hi
      if (inBand) {
        sum += bytes[j]
        count++
      }
    }
    let value: number
    if (count > 0) {
      value = sum / count / 255
    } else {
      const centerHz = Math.sqrt(lo * hi)
      let nearest = 0
      let nearestDist = Infinity
      for (let j = 0; j < nBins; j++) {
        const dist = Math.abs(binHz(j) - centerHz)
        if (dist < nearestDist) {
          nearestDist = dist
          nearest = j
        }
      }
      value = bytes[nearest] / 255
    }
    out[b] = Math.max(0, Math.min(1, value))
  }
  return out
}

export interface OnsetDetectorOptions {
  /** How far above the decaying envelope `energy` must rise to count as a new onset. */
  rise?: number
  /** Per-push multiplicative decay applied to the envelope while not onsetting. */
  decay?: number
}

/**
 * Fires once when pushed energy jumps above a slowly decaying envelope by
 * more than `rise`; the envelope then snaps up to the current energy so a
 * sustained note (energy holding roughly steady) doesn't keep re-firing.
 * The envelope decays toward silence between notes so a later, quieter
 * attack can still register as a fresh onset.
 */
export class OnsetDetector {
  private readonly rise: number
  private readonly decay: number
  private envelope = 0

  constructor(opts?: OnsetDetectorOptions) {
    this.rise = opts?.rise ?? 0.12
    this.decay = opts?.decay ?? 0.92
  }

  push(energy: number): boolean {
    const rose = energy > this.envelope + this.rise
    if (rose) {
      this.envelope = energy
    } else {
      this.envelope = Math.max(energy, this.envelope * this.decay)
    }
    return rose
  }
}
