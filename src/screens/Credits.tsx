// Photo credits for the reward collection (see src/content/collection.ts).
// Every photo comes from Wikimedia Commons under a free licence; this
// screen thanks the photographers and links back to each source page, as
// the licences require. Registered at /credits by App.tsx.

import { COLLECTION, itemImageUrl } from '../content/collection'
import { CREDITS } from '../content/collectionCredits'

export function Credits() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1rem 1rem 2rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Photo credits</h1>
      <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>
        The photos in the collection come from Wikimedia Commons. Thank you to the photographers!
      </p>

      <div className="cc-card" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column' }}>
        {COLLECTION.map((item) => {
          const credit = CREDITS[item.id]
          return (
            <a
              key={item.id}
              href={credit?.source ?? 'https://commons.wikimedia.org/'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                minHeight: 56,
                padding: '0.5rem 0.5rem',
                borderBottom: '1px solid var(--cc-border)',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <img
                src={itemImageUrl(item)}
                alt=""
                style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: '0.6rem', flexShrink: 0 }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
                <strong>{item.name}</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--cc-ink-soft)' }}>
                  Photo: {credit?.author ?? 'Unknown'} · {credit?.license ?? 'Unknown'}
                </span>
              </span>
            </a>
          )
        })}
      </div>

      <button type="button" className="cc-btn cc-btn-surface" onClick={() => history.back()}>
        Back
      </button>
    </div>
  )
}
