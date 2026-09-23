/** Three big star slots; filled stars animate in one at a time. Renders nothing at 0 stars. */
export function StarBurst({ stars }: { stars: 0 | 1 | 2 | 3 }) {
  if (stars === 0) return null

  return (
    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }} aria-label={`${stars} of 3 stars`}>
      {[0, 1, 2].map((i) => {
        const filled = i < stars
        return (
          <span
            key={i}
            className={filled ? 'ra-star ra-star-fill' : 'ra-star'}
            style={filled ? { animationDelay: `${i * 150}ms` } : undefined}
            aria-hidden="true"
          >
            {filled ? '⭐' : '☆'}
          </span>
        )
      })}
    </div>
  )
}
