import { useState } from 'react'
import { RARITY_META, type CollectionItem } from '../content/collection'
import { Album, CardPhoto, RarityStars } from '../components/Album'
import { BadgeShelf } from '../components/BadgeShelf'
import { BadgeToast } from '../components/BadgeToast'
import { fireConfetti } from '../components/Confetti'
import { SayIt } from '../components/SayIt'
import { awardNewBadges } from '../store/badges'
import { awardItem } from '../store/collection'
import { getDoc, update, useProgress, type Rarity, type Ticket } from '../store/progress'
import { formatCents, pickWeighted, rollBoxContents, rollCashCents, rollTicket, type Tier } from '../store/rewards'
import { PinGate } from './Settings'

const TIER_META: Record<Tier, { label: string; emoji: string; color: string }> = {
  gold: { label: 'Gold Box', emoji: '🟡', color: '#f5d91a' },
  silver: { label: 'Silver Box', emoji: '⚪', color: '#c7cad9' },
  bronze: { label: 'Bronze Box', emoji: '🟤', color: '#c98a4b' },
}

type BoxTab = 'boxes' | 'cards' | 'tickets'

interface OpenResult {
  tier: Tier
  item: CollectionItem
  rarity: Rarity
  duplicate: boolean
  ticket?: Ticket
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function BoxResultCard({ result, onOpenAnother, onSeeCards }: { result: OpenResult; onOpenAnother: () => void; onSeeCards: () => void }) {
  const [factOpen, setFactOpen] = useState(false)
  const meta = RARITY_META[result.rarity]

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
        zIndex: 50,
      }}
    >
      <style>{`
        @keyframes cc-card-flip {
          0% { transform: rotateY(90deg) scale(0.75); opacity: 0; }
          60% { transform: rotateY(-8deg) scale(1.03); opacity: 1; }
          100% { transform: rotateY(0deg) scale(1); opacity: 1; }
        }
      `}</style>
      <div
        data-testid="box-result"
        className="cc-card"
        style={{
          padding: '1.75rem',
          maxWidth: 360,
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          animation: 'cc-card-flip 550ms ease-out',
          boxShadow: `0 0 36px ${meta.colour}99, var(--cc-shadow)`,
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{TIER_META[result.tier].emoji} You got a card!</h2>
        <div style={{ margin: '0 auto' }}>
          <CardPhoto item={result.item} size={128} />
        </div>
        <p data-testid="box-item-name" style={{ margin: 0, fontWeight: 800, fontSize: '1.1rem' }}>
          {result.item.name}
        </p>
        <p data-testid="box-rarity" style={{ margin: 0 }}>
          <RarityStars rarity={result.rarity} />
        </p>
        <p style={{ margin: 0, color: 'var(--cc-ink-soft)', fontWeight: 700 }}>{result.item.where}</p>

        {result.duplicate && (
          <p style={{ margin: 0, background: 'var(--cc-bg)', borderRadius: '0.75rem', padding: '0.5rem', fontWeight: 700 }}>
            You already have this one! ✨
          </p>
        )}

        {!factOpen ? (
          <button type="button" className="cc-btn cc-btn-surface" style={{ minHeight: 56 }} onClick={() => setFactOpen(true)}>
            Read the fact
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ margin: 0 }}>{result.item.fact}</p>
            <SayIt text={result.item.say ?? result.item.fact} />
          </div>
        )}

        {result.ticket && (
          <p style={{ margin: 0 }}>
            🎟️ Plus a prize ticket: <strong>{result.ticket.emoji} {result.ticket.name}</strong>!
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="cc-btn cc-btn-surface" style={{ flex: 1, minHeight: 56 }} onClick={onOpenAnother}>
            Open another
          </button>
          <button type="button" className="cc-btn cc-btn-primary" style={{ flex: 1, minHeight: 56 }} onClick={onSeeCards}>
            See my cards
          </button>
        </div>
      </div>
    </div>
  )
}

function BoxesTab({ onResultShown }: { onResultShown: () => void }) {
  const progress = useProgress()
  const profile = progress.profile
  const [opening, setOpening] = useState<Tier | null>(null)
  const [result, setResult] = useState<OpenResult | null>(null)

  function openBox(tier: Tier) {
    if (profile.tokens[tier] <= 0 || opening) return
    setOpening(tier)

    update('profile', (p) => ({ ...p, tokens: { ...p.tokens, [tier]: p.tokens[tier] - 1 } }))

    setTimeout(() => {
      const doc = getDoc()
      const lastItemId = doc.rewards.boxHistory.at(-1)?.itemId
      const { item, rarity, duplicate } = rollBoxContents(tier, doc.collection.items, lastItemId)

      const getsTicket = rollTicket(doc.settings.ticketChance[tier])
      const prizePool = doc.settings.prizePools[tier]
      const prize = getsTicket ? pickWeighted(prizePool) : undefined
      const now = Date.now()
      const cashCents = prize?.kind === 'cash' ? rollCashCents(prize) : undefined
      const ticketEntry: Ticket | undefined = prize
        ? {
            id: uid(),
            prizeId: prize.id,
            name: cashCents !== undefined ? formatCents(cashCents) : prize.name,
            emoji: prize.emoji,
            tier,
            wonAt: now,
            ...(cashCents !== undefined ? { amountCents: cashCents } : {}),
          }
        : undefined

      awardItem(item.id, now)

      update('rewards', (rewards) => ({
        ...rewards,
        tickets: ticketEntry ? [...rewards.tickets, ticketEntry] : rewards.tickets,
        boxHistory: [
          ...rewards.boxHistory,
          {
            tier,
            openedAt: now,
            result: ticketEntry ? `${item.name} + 🎟️ ${ticketEntry.name}` : item.name,
            itemId: item.id,
          },
        ],
      }))

      awardNewBadges()
      fireConfetti(rarity === 'legendary' ? 'big' : tier === 'gold' ? 'big' : 'small')
      setResult({ tier, item, rarity, duplicate, ticket: ticketEntry })
      setOpening(null)
    }, 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {(['gold', 'silver', 'bronze'] as Tier[]).map((tier) => {
          const meta = TIER_META[tier]
          const count = profile.tokens[tier]
          return (
            <div
              key={tier}
              className="cc-card"
              style={{ flex: '1 1 140px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'center' }}
            >
              <span style={{ fontSize: '2.5rem' }} aria-hidden="true">
                {meta.emoji}
              </span>
              <strong>{meta.label}</strong>
              <span style={{ color: 'var(--cc-ink-soft)', fontWeight: 700 }}>You have: {count}</span>
              <button
                type="button"
                className="cc-btn cc-btn-primary"
                disabled={count <= 0 || opening !== null}
                onClick={() => openBox(tier)}
                style={{ width: '100%', animation: opening === tier ? 'cc-shake 400ms infinite' : undefined }}
              >
                {opening === tier ? 'Opening...' : 'Open'}
              </button>
            </div>
          )
        })}
      </div>

      {result && (
        <BoxResultCard
          result={result}
          onOpenAnother={() => setResult(null)}
          onSeeCards={() => {
            setResult(null)
            onResultShown()
          }}
        />
      )}
    </div>
  )
}

function TicketsTab() {
  const progress = useProgress()
  const [redeeming, setRedeeming] = useState<Ticket | null>(null)
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null)

  const tickets = [...progress.rewards.tickets].sort((a, b) => {
    if (Boolean(a.redeemedAt) !== Boolean(b.redeemedAt)) return a.redeemedAt ? 1 : -1
    return b.wonAt - a.wonAt
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {redeemMsg && <div className="cc-card" style={{ padding: '1rem', background: 'var(--cc-bg)', fontWeight: 700 }}>{redeemMsg}</div>}
      {redeeming && (
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
            zIndex: 50,
          }}
        >
          <div className="cc-card" style={{ padding: '1.25rem', maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
              Hand over {redeeming.emoji} {redeeming.name}
            </h2>
            <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>A grown-up enters the PIN to mark this ticket as redeemed.</p>
            <PinGate
              pin={progress.settings.pin}
              onUnlock={() => {
                const id = redeeming.id
                const name = redeeming.name
                update('rewards', (r) => ({
                  ...r,
                  tickets: r.tickets.map((x) => (x.id === id ? { ...x, redeemedAt: Date.now() } : x)),
                }))
                fireConfetti('small')
                setRedeeming(null)
                setRedeemMsg(`Enjoy your ${name}, ${progress.settings.kidName}! 🎉`)
              }}
            />
            <button type="button" className="cc-btn cc-btn-surface" onClick={() => setRedeeming(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="cc-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {tickets.length === 0 && <p style={{ margin: 0, color: 'var(--cc-ink-soft)' }}>No tickets yet.</p>}
        {tickets.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.75rem',
              background: t.redeemedAt ? 'var(--cc-bg)' : 'var(--cc-surface)',
              border: '1px solid var(--cc-border)',
              opacity: t.redeemedAt ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>🎟️</span>
            <span style={{ fontWeight: 700, flex: 1 }}>
              {t.emoji} {t.name}
            </span>
            {t.redeemedAt ? (
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--cc-ink-soft)' }}>
                Redeemed {new Date(t.redeemedAt).toLocaleDateString()}
              </span>
            ) : (
              <button type="button" className="cc-btn cc-btn-primary" style={{ minHeight: 44, padding: '0 0.9rem' }} onClick={() => setRedeeming(t)}>
                Redeem 🎟️
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const TABS: { id: BoxTab; label: string; emoji: string }[] = [
  { id: 'boxes', label: 'Boxes', emoji: '🎁' },
  { id: 'cards', label: 'Cards', emoji: '📷' },
  { id: 'tickets', label: 'Tickets', emoji: '🎟️' },
]

export function BlindBox() {
  const progress = useProgress()
  const [tab, setTab] = useState<BoxTab>('boxes')
  const openTicketCount = progress.rewards.tickets.filter((t) => !t.redeemedAt).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1rem 1rem 2rem' }}>
      <BadgeToast />
      <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Blind Box</h1>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`tab-${t.id}`}
              className="cc-btn"
              onClick={() => setTab(t.id)}
              style={{
                flex: '1 1 76px',
                minHeight: 56,
                flexDirection: 'column',
                gap: '0.1rem',
                background: active ? 'var(--cc-primary)' : 'var(--cc-surface)',
                color: active ? '#fff' : 'var(--cc-ink)',
                border: active ? 'none' : '2px solid var(--cc-border)',
                boxShadow: 'none',
              }}
            >
              <span style={{ fontSize: '1.2rem' }} aria-hidden="true">
                {t.emoji}
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 800 }}>
                {t.label}
                {t.id === 'tickets' && openTicketCount > 0 ? ` (${openTicketCount})` : ''}
              </span>
            </button>
          )
        })}
      </div>

      {tab === 'boxes' && <BoxesTab onResultShown={() => setTab('cards')} />}
      {tab === 'cards' && (
        <>
          <Album />
          <BadgeShelf />
        </>
      )}
      {tab === 'tickets' && <TicketsTab />}
    </div>
  )
}
