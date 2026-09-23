const BAR_COUNT = 12

/** A simple 12-bar level meter, 0..1, used on the Record screen so a silent room visibly reads as flat. */
export function LevelMeter({ level }: { level: number }) {
  const clamped = Math.max(0, Math.min(1, level))
  const lit = Math.round(clamped * BAR_COUNT)
  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.2rem', height: 32 }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          style={{
            display: 'block',
            width: 6,
            height: 8 + i * 2,
            borderRadius: 2,
            background: i < lit ? 'var(--cc-success)' : 'var(--cc-border)',
          }}
        />
      ))}
    </div>
  )
}
