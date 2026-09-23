export interface LevelChipsProps {
  levels: { level: number; name: string }[]
  selected: number
  onSelect: (level: number) => void
}

/** Horizontally-scrollable level pills, the selected one filled with the primary color. */
export function LevelChips({ levels, selected, onSelect }: LevelChipsProps) {
  return (
    <div className="ra-level-chips" role="tablist" aria-label="Reading level">
      {levels.map((l) => {
        const active = l.level === selected
        return (
          <button
            key={l.level}
            type="button"
            role="tab"
            aria-selected={active}
            className={`cc-btn ${active ? 'cc-btn-primary' : 'cc-btn-surface'}`}
            style={{ flexShrink: 0 }}
            onClick={() => onSelect(l.level)}
          >
            {l.name}
          </button>
        )
      })}
    </div>
  )
}
