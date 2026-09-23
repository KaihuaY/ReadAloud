/** A circular progress ring with a big label in the middle, used for both activities' timers. */
export function RingTimer({
  progress,
  label,
  size = 96,
  color = 'var(--cc-primary)',
  sublabel,
}: {
  progress: number
  label: string
  size?: number
  color?: string
  sublabel?: string
}) {
  const stroke = Math.max(4, Math.round(size * 0.104))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  return (
    <svg width={size} height={size} role="img" aria-label={label} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cc-border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 250ms linear' }}
      />
      <text
        x="50%"
        y={sublabel ? '42%' : '50%'}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="1rem"
        fontWeight={800}
        fill="var(--cc-ink)"
      >
        {label}
      </text>
      {sublabel && (
        <text x="50%" y="64%" textAnchor="middle" dominantBaseline="central" fontSize="0.55rem" fontWeight={700} fill="var(--cc-ink-soft)">
          {sublabel}
        </text>
      )}
    </svg>
  )
}
