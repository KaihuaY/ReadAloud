// The "silence doesn't count" core: turns a stream of RMS level samples into
// "was the piano actually being played" milliseconds. Pure and
// framework-free so it can be driven by the real AnalyserNode loop, the fake
// backend, or a test - all it needs is (rms, t) pairs.
//
// - An adaptive noise floor tracks room hum / iPad self-noise, so a quiet
//   room doesn't need hand tuning and a slightly noisy one doesn't get
//   credited as "playing".
// - A 2 s hold means a decaying note (or the silence between two notes of
//   the same phrase) still counts as active.
// - A short warm-up avoids counting a burst of initial mic noise before the
//   floor has calibrated.
// - `dt` is clamped so a throttled background tab can't award minutes for
//   time it never actually sampled.

export interface ActivityMeterOptions {
  /** How long activity is "held" after the last loud sample, ms. */
  holdMs?: number
  /** Absolute floor below which nothing is ever considered loud. */
  minThreshold?: number
  /** Threshold = max(minThreshold, floor * floorRatio). */
  floorRatio?: number
  /** How fast the floor rises toward a louder-than-floor sample while inactive. */
  floorRiseAlpha?: number
  /** How fast the floor falls toward a quieter-than-floor sample while inactive. */
  floorFallAlpha?: number
  /** No time is credited as active until this long after the first sample. */
  warmupMs?: number
  /** Max time delta credited per sample, so a stalled tab can't inflate activeMs. */
  maxDtMs?: number
}

export interface MeterFrame {
  active: boolean
  level: number
  activeMs: number
  silentMs: number
}

const DEFAULTS: Required<ActivityMeterOptions> = {
  holdMs: 2000,
  minThreshold: 0.012,
  floorRatio: 2.5,
  floorRiseAlpha: 0.02,
  floorFallAlpha: 0.3,
  warmupMs: 1000,
  maxDtMs: 500,
}

const MIN_FLOOR = 0.0005

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

export class ActivityMeter {
  private readonly opts: Required<ActivityMeterOptions>
  private startT: number | null = null
  private lastT: number | null = null
  private lastLoudAt: number | null = null
  private floorValue: number = MIN_FLOOR
  private accumulatedActiveMs = 0
  private lastSilentMs = 0

  constructor(opts?: ActivityMeterOptions) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  get activeMs(): number {
    return this.accumulatedActiveMs
  }

  get silentMs(): number {
    return this.lastSilentMs
  }

  get floor(): number {
    return this.floorValue
  }

  push(rms: number, t: number): MeterFrame {
    const o = this.opts

    if (this.startT === null) {
      this.startT = t
      this.lastT = t
      this.floorValue = Math.max(rms, MIN_FLOOR)
    }

    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, o.maxDtMs)
    this.lastT = t

    const threshold = Math.max(o.minThreshold, this.floorValue * o.floorRatio)
    if (rms > threshold) {
      this.lastLoudAt = t
    }

    const active = this.lastLoudAt !== null && t - this.lastLoudAt < o.holdMs

    if (active && t - this.startT >= o.warmupMs) {
      this.accumulatedActiveMs += dt
    }

    if (!active) {
      const alpha = rms > this.floorValue ? o.floorRiseAlpha : o.floorFallAlpha
      this.floorValue += (rms - this.floorValue) * alpha
      if (this.floorValue < MIN_FLOOR) this.floorValue = MIN_FLOOR
    }

    this.lastSilentMs = this.lastLoudAt === null ? t - this.startT : t - this.lastLoudAt

    const level = clamp01((rms - this.floorValue) / Math.max(0.05, threshold * 4))

    return { active, level, activeMs: this.accumulatedActiveMs, silentMs: this.lastSilentMs }
  }
}
