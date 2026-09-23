// The "Cards" tab of the Blind Box screen (src/screens/BlindBox.tsx): one
// grid per collection set (gems/animals/space), owned cards shown with their
// photo, unowned cards as a silhouette hinting at the rarity, and a tap on
// an owned card opens ItemCardModal with the full fact. Also shows the
// emoji stickers won from 3-star reads (src/content/stickers.ts).

import { useEffect, useMemo, useState } from 'react'
import { RARITY_META, SETS, itemImageUrl, itemsInSet, type CollectionItem, type CollectionSet } from '../content/collection'
import { awardNewBadges } from '../store/badges'
import { ownedItem, useCollection } from '../store/collection'
import { useProgress } from '../store/progress'
import { fireConfetti } from './Confetti'
import { SayIt } from './SayIt'

/** A card's photo, falling back to its emoji if the image is missing/broken. Never blocks render on the image load. */
export function CardPhoto({ item, size }: { item: CollectionItem; size: number }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span style={{ fontSize: size * 0.7, lineHeight: 1 }} aria-hidden="true">
        {item.emoji}
      </span>
    )
  }
  return (
    <img
      src={itemImageUrl(item)}
      alt={item.name}
      onError={() => setBroken(true)}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: '0.6rem' }}
    />
  )
}

/** ★/☆ out of 5, filled up to the rarity's star count. */
export function RarityStars({ rarity }: { rarity: CollectionItem['rarity'] }) {
  const meta = RARITY_META[rarity]
  return (
    <span aria-label={`${meta.label}, ${meta.stars} out of 5 stars`} style={{ color: meta.colour, fontWeight: 800, letterSpacing: '0.05em' }}>
      {'★'.repeat(meta.stars)}
      <span style={{ opacity: 0.35 }}>{'☆'.repeat(5 - meta.stars)}</span>
    </span>
  )
}

function ItemCardModal({ item, onClose }: { item: CollectionItem; onClose: () => void }) {
  const meta = RARITY_META[item.rarity]
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16,18,43,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <div
        className="cc-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '1.5rem', maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
      >
        <div style={{ margin: '0 auto', filter: `drop-shadow(0 0 14px ${meta.colour}aa)` }}>
          <CardPhoto item={item} size={140} />
        </div>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{item.name}</h2>
        <RarityStars rarity={item.rarity} />
        <p style={{ margin: 0, color: 'var(--cc-ink-soft)', fontWeight: 700 }}>{item.where}</p>
        <p style={{ margin: 0 }}>{item.fact}</p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <SayIt text={item.say ?? item.fact} />
        </div>
        <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 56 }} onClick={onClose}>
          Got it!
        </button>
      </div>
    </div>
  )
}

export function Album() {
  const progress = useProgress()
  const collection = useCollection()
  const [activeSet, setActiveSet] = useState<CollectionSet>('gems')
  const [openItem, setOpenItem] = useState<CollectionItem | null>(null)
  const [stickersOpen, setStickersOpen] = useState(false)

  const cardsInSet = useMemo(() => itemsInSet(activeSet), [activeSet])
  const ownedCountInSet = cardsInSet.filter((c) => (ownedItem(c.id, collection)?.count ?? 0) > 0).length

  // The moment a set becomes fully owned, the badge mechanism records it -
  // fire the bigger celebration right here since that's the only place she'd see it happen live.
  useEffect(() => {
    if (cardsInSet.length === 0 || ownedCountInSet < cardsInSet.length) return
    const newIds = awardNewBadges()
    if (newIds.some((id) => id.startsWith('set-'))) fireConfetti('big')
  }, [ownedCountInSet, cardsInSet.length])

  const stickers = progress.rewards.stickers

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {SETS.map((s) => {
          const cards = itemsInSet(s.id)
          const ownedInThisSet = cards.filter((c) => (ownedItem(c.id, collection)?.count ?? 0) > 0).length
          const active = activeSet === s.id
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`album-set-${s.id}`}
              className="cc-btn"
              onClick={() => setActiveSet(s.id)}
              style={{
                flex: 1,
                minHeight: 56,
                flexDirection: 'column',
                gap: '0.15rem',
                background: active ? 'var(--cc-primary)' : 'var(--cc-surface)',
                color: active ? '#fff' : 'var(--cc-ink)',
                border: active ? 'none' : '2px solid var(--cc-border)',
                boxShadow: 'none',
              }}
            >
              <span style={{ fontSize: '1.3rem' }} aria-hidden="true">
                {s.emoji}
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>
                {ownedInThisSet}/{cards.length}
              </span>
            </button>
          )
        })}
      </div>

      <div className="cc-card" style={{ padding: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
        {cardsInSet.map((card) => {
          const own = ownedItem(card.id, collection)
          const isOwned = (own?.count ?? 0) > 0
          const meta = RARITY_META[card.rarity]
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`album-card-${card.id}`}
              data-owned={isOwned ? 'true' : 'false'}
              onClick={() => isOwned && setOpenItem(card)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
                padding: '0.5rem 0.3rem',
                borderRadius: '0.75rem',
                border: `3px solid ${meta.colour}`,
                background: isOwned ? 'var(--cc-surface)' : '#1a1c33',
                cursor: isOwned ? 'pointer' : 'default',
                minHeight: 96,
              }}
            >
              {isOwned ? (
                <>
                  <CardPhoto item={card} size={48} />
                  <span style={{ fontSize: '0.62rem', fontWeight: 800, textAlign: 'center', color: 'var(--cc-ink)' }}>{card.name}</span>
                  {(own?.count ?? 0) > 1 && <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--cc-ink-soft)' }}>×{own?.count}</span>}
                </>
              ) : (
                <>
                  <span style={{ fontSize: '1.8rem', color: '#6a6d90' }} aria-hidden="true">
                    ?
                  </span>
                  <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#9497bd' }}>{meta.label}</span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {stickers.length > 0 && (
        <div className="cc-card" style={{ padding: '0.75rem' }}>
          <button
            type="button"
            className="cc-btn cc-btn-surface"
            style={{ width: '100%', minHeight: 56 }}
            onClick={() => setStickersOpen((v) => !v)}
          >
            {stickersOpen ? '▾' : '▸'} My stickers ({stickers.length})
          </button>
          {stickersOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: '0.5rem', marginTop: '0.6rem' }}>
              {stickers.map((s, i) => (
                <span key={`${s.id}-${i}`} style={{ fontSize: '1.6rem', textAlign: 'center' }}>
                  {s.kind === 'emoji' ? s.value : <img src={s.value} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {openItem && <ItemCardModal item={openItem} onClose={() => setOpenItem(null)} />}
    </div>
  )
}
