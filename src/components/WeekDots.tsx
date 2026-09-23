/** A row of dots for the last several local days, lit up for the ones with practice logged. */
export function WeekDots({ days, done }: { days: string[]; done: Set<string> }) {
  return (
    <div style={{ display: 'flex', gap: '0.35rem' }} aria-label="This week's practice days">
      {days.map((day) => (
        <span
          key={day}
          title={day}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: done.has(day) ? 'var(--cc-success)' : 'var(--cc-border)',
          }}
        />
      ))}
    </div>
  )
}
