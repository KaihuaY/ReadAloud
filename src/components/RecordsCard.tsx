import { RECORD_KEYS, RECORD_LABELS, useRecords, type RecordKey } from '../store/records'

/** "2026-09-19" -> "Sep 19", parsed as a local date so it never drifts a day from UTC parsing. */
function formatRecordDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatValue(key: RecordKey, value: number): string {
  switch (key) {
    case 'mostReadsInDay':
      return `${value} read${value === 1 ? '' : 's'}`
    case 'longestStreakDays':
      return `${value} day${value === 1 ? '' : 's'}`
    case 'smoothestRead':
      return `${value}`
    case 'passagesWithThreeStars':
      return `${value} stor${value === 1 ? 'y' : 'ies'}`
  }
}

/** "🏆 My records": one row per personal record, or an encouraging placeholder before it's set. Renders nothing until the first take (see useRecords()). */
export function RecordsCard() {
  const records = useRecords()
  if (!records) return null

  return (
    <div data-testid="records-card" className="cc-card" style={{ padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <strong>🏆 My records</strong>
      {RECORD_KEYS.map((key) => {
        const entry = records[key]
        const label = RECORD_LABELS[key]
        return (
          <div
            key={key}
            data-testid={`record-row-${key}`}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.6rem' }}
          >
            <span>
              {label.emoji} {label.title}
            </span>
            {entry ? (
              <span style={{ fontWeight: 700, textAlign: 'right' }}>
                {formatValue(key, entry.value)}{' '}
                <span style={{ fontWeight: 600, color: 'var(--cc-ink-soft)', fontSize: '0.8rem' }}>{formatRecordDay(entry.day)}</span>
              </span>
            ) : (
              <span style={{ color: 'var(--cc-ink-soft)', fontSize: '0.85rem' }}>not yet - keep reading!</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
