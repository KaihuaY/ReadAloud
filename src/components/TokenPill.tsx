import type { CSSProperties } from 'react'
import { navigate } from '../router'

/** The gold/silver/bronze token counter button that opens the Blind Box screen. */
export function TokenPill({
  tokens,
  style,
}: {
  tokens: { gold: number; silver: number; bronze: number }
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      onClick={() => navigate('/box')}
      className="cc-btn cc-btn-surface"
      style={{ gap: '0.5rem', padding: '0.4rem 0.75rem', minHeight: 40, ...style }}
      aria-label="Open the Blind Box screen"
    >
      <span>🟡{tokens.gold}</span>
      <span>⚪{tokens.silver}</span>
      <span>🟤{tokens.bronze}</span>
    </button>
  )
}
