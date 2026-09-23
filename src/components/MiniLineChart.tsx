// A small dependency-free SVG line chart for one metric's history (see the
// `dataviz` skill: single series so no legend box is needed - the title
// names it; 2px line, >=8px end markers with a surface-color ring, min/max
// axis labels only, direct first/last labels instead of a dense axis, and a
// status-colored trend arrow rather than a second encoding). The app is
// light-only (see index.css), so this draws with the app's own --cc-*
// tokens and has no separate dark-mode branch.

export interface MiniLineChartPoint {
  label: string
  value: number | undefined
}

interface MiniLineChartProps {
  points: MiniLineChartPoint[]
  min?: number
  max?: number
  format?: (v: number) => string
  title: string
  goodDirection: 'up' | 'down'
  /** True for a metric that isn't a score (e.g. tempo): the arrow still shows direction but never turns green/red. */
  neutral?: boolean
}

const WIDTH = 300
const HEIGHT = 108
const PAD_X = 12
const PAD_TOP = 12
const PAD_BOTTOM = 22

function defaultFormat(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

export function MiniLineChart({ points, min, max, format = defaultFormat, title, goodDirection, neutral = false }: MiniLineChartProps) {
  const values = points.map((p) => p.value).filter((v): v is number => v !== undefined)

  if (values.length === 0) {
    return (
      <div className="cc-card" style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>{title}</strong>
        <span style={{ color: 'var(--cc-ink-soft)', fontSize: '0.85rem' }}>Not enough plays yet.</span>
      </div>
    )
  }

  const dataMin = min ?? Math.min(...values)
  const dataMax = max ?? Math.max(...values)
  const span = dataMax - dataMin || 1
  const n = points.length
  const stepX = n > 1 ? (WIDTH - PAD_X * 2) / (n - 1) : 0

  const xFor = (i: number) => PAD_X + stepX * i
  const yFor = (v: number) => HEIGHT - PAD_BOTTOM - ((v - dataMin) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM)

  // One path per unbroken run of defined values - undefined points leave a gap.
  const segments: string[] = []
  let current = ''
  points.forEach((p, i) => {
    if (p.value === undefined) {
      if (current) segments.push(current)
      current = ''
      return
    }
    current += `${current ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)} `
  })
  if (current) segments.push(current)

  const firstIdx = points.findIndex((p) => p.value !== undefined)
  let lastIdx = -1
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value !== undefined) {
      lastIdx = i
      break
    }
  }
  const firstVal = points[firstIdx].value as number
  const lastVal = points[lastIdx].value as number
  const delta = lastVal - firstVal
  const improved = goodDirection === 'up' ? delta > 0 : delta < 0
  const worsened = goodDirection === 'up' ? delta < 0 : delta > 0
  const trendColor = neutral || delta === 0 ? 'var(--cc-ink-soft)' : improved ? 'var(--cc-success)' : worsened ? 'var(--cc-danger)' : 'var(--cc-ink-soft)'
  const arrow = delta === 0 ? '→' : delta > 0 ? '↗' : '↘'
  const changeWord = delta === 0 ? 'unchanged' : improved ? 'improved' : 'changed'

  const ariaLabel = `${title}: ${format(firstVal)} on ${points[firstIdx].label}, now ${format(lastVal)} on ${points[lastIdx].label} - ${changeWord}.`

  return (
    <div className="cc-card" style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>{title}</strong>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
          <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>{format(lastVal)}</span>
          <span aria-hidden="true" style={{ color: trendColor, fontWeight: 800, fontSize: '1.1rem' }}>
            {arrow}
          </span>
        </span>
      </div>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', maxWidth: 320, height: 'auto', display: 'block' }}
      >
        {segments.map((d, i) => (
          <path key={i} d={d.trim()} fill="none" stroke="var(--cc-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {points.map((p, i) =>
          p.value === undefined ? null : (
            <circle key={i} cx={xFor(i)} cy={yFor(p.value)} r={4} fill="var(--cc-primary)" stroke="var(--cc-surface)" strokeWidth={2} />
          ),
        )}
        <text x={2} y={PAD_TOP + 3} fontSize={9} fill="var(--cc-ink-soft)">
          {format(dataMax)}
        </text>
        <text x={2} y={HEIGHT - PAD_BOTTOM + 3} fontSize={9} fill="var(--cc-ink-soft)">
          {format(dataMin)}
        </text>
        <text x={PAD_X} y={HEIGHT - 4} fontSize={9} fill="var(--cc-ink-soft)">
          {points[0].label}
        </text>
        <text x={WIDTH - PAD_X} y={HEIGHT - 4} fontSize={9} fill="var(--cc-ink-soft)" textAnchor="end">
          {points[n - 1].label}
        </text>
      </svg>
    </div>
  )
}
