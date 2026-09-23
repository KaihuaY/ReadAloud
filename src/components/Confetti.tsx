import confetti from 'canvas-confetti'

// Bright, kid-friendly cube-sticker colors for the confetti bursts.
const CONFETTI_COLORS = ['#f5d91a', '#ff8a00', '#1fa953', '#f5f5f5', '#e62b2b', '#1f5fd9']

/** Fires a confetti burst. 'small' for a stage win, 'big' for a full solve. */
export function fireConfetti(level: 'small' | 'big' = 'small') {
  if (typeof window === 'undefined') return

  if (level === 'small') {
    confetti({
      particleCount: 40,
      spread: 55,
      startVelocity: 35,
      origin: { y: 0.7 },
      colors: CONFETTI_COLORS,
      disableForReducedMotion: true,
    })
    return
  }

  // Big celebration: a couple of side cannons plus a center burst.
  const end = Date.now() + 800
  ;(function frame() {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 65,
      origin: { x: 0, y: 0.75 },
      colors: CONFETTI_COLORS,
      disableForReducedMotion: true,
    })
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 65,
      origin: { x: 1, y: 0.75 },
      colors: CONFETTI_COLORS,
      disableForReducedMotion: true,
    })
    if (Date.now() < end) requestAnimationFrame(frame)
  })()

  confetti({
    particleCount: 120,
    spread: 100,
    startVelocity: 45,
    origin: { y: 0.6 },
    colors: CONFETTI_COLORS,
    disableForReducedMotion: true,
  })
}
