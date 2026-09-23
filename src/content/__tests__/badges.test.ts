import { describe, expect, it } from 'vitest'
import { BADGES, earnedBadges } from '../badges'
import { itemsInSet } from '../collection'
import { passagesForLevel } from '../passages'
import { defaultDoc, type OwnedItem, type ProgressDoc, type ReadingTake } from '../../store/progress'

function take(overrides: Partial<ReadingTake> = {}): ReadingTake {
  return {
    id: 'take-1',
    day: '2026-09-07',
    passageId: 'passage-1',
    startedAt: 0,
    durationSec: 60,
    mimeType: 'audio/webm',
    sizeBytes: 1000,
    hasAudio: true,
    deviceId: 'device-1',
    ...overrides,
  }
}

function threeStarTake(id: string, passageId: string): ReadingTake {
  return take({
    id,
    passageId,
    score: {
      outcome: 'full',
      stars: 3,
      attempted: 5,
      read: 5,
      stumbled: 0,
      different: 0,
      skipped: 0,
      accuracy: 1,
      cleanAccuracy: 1,
      coverage: 1,
      wcpm: 60,
      trickyWords: [],
      newPassageBest: false,
    },
  })
}

function owned(id: string, count = 1): OwnedItem {
  return { id, count, firstAt: 1 }
}

describe('earnedBadges - reads', () => {
  it('first-read, ten-reads and fifty-reads fire at their counts', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.reading.takes = [take({ id: 't0' })]
    expect(earnedBadges(doc)).toContain('first-read')
    expect(earnedBadges(doc)).not.toContain('ten-reads')

    doc.reading.takes = Array.from({ length: 10 }, (_, i) => take({ id: `t${i}` }))
    expect(earnedBadges(doc)).toContain('ten-reads')
    expect(earnedBadges(doc)).not.toContain('fifty-reads')

    doc.reading.takes = Array.from({ length: 50 }, (_, i) => take({ id: `t${i}` }))
    expect(earnedBadges(doc)).toContain('fifty-reads')
  })

  it('word-practice takes ("Try just this word") never count toward first-read/ten-reads', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.reading.takes = Array.from({ length: 10 }, (_, i) => take({ id: `w${i}`, passageId: 'word:cat' }))
    expect(earnedBadges(doc)).not.toContain('first-read')
    expect(earnedBadges(doc)).not.toContain('ten-reads')
  })
})

describe('earnedBadges - streaks', () => {
  it('fires streak milestones off streak.best, not current', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.reading.streak = { current: 1, best: 7, lastDay: '2026-09-07' }
    const earned = earnedBadges(doc)
    expect(earned).toContain('streak-3')
    expect(earned).toContain('streak-7')
    expect(earned).not.toContain('streak-14')
  })
})

describe('earnedBadges - stars', () => {
  it('first-three-stars and five-three-star-reads count 3-star takes', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.reading.takes = [threeStarTake('t0', 'p0')]
    expect(earnedBadges(doc)).toContain('first-three-stars')
    expect(earnedBadges(doc)).not.toContain('five-three-star-reads')

    doc.reading.takes = Array.from({ length: 5 }, (_, i) => threeStarTake(`t${i}`, `p${i}`))
    expect(earnedBadges(doc)).toContain('five-three-star-reads')
  })

  it('a 3-star word-practice take never counts toward first-three-stars', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.reading.takes = [threeStarTake('w0', 'word:cat')]
    expect(earnedBadges(doc)).not.toContain('first-three-stars')
  })
})

describe('earnedBadges - level done', () => {
  it('fires level-done-1 only once every built-in level-1 passage has a 3-star take', () => {
    const level1 = passagesForLevel(1)
    expect(level1.length).toBeGreaterThan(0)

    const doc: ProgressDoc = defaultDoc()
    doc.reading.takes = level1.slice(0, -1).map((p, i) => threeStarTake(`t${i}`, p.id))
    expect(earnedBadges(doc)).not.toContain('level-done-1')

    doc.reading.takes = level1.map((p, i) => threeStarTake(`t${i}`, p.id))
    expect(earnedBadges(doc)).toContain('level-done-1')
    expect(earnedBadges(doc)).not.toContain('level-done-2')
  })
})

describe('earnedBadges - tricky words', () => {
  it('tricky-tamer fires once a practiced word has 3+ successes', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.reading.practice = { fox: { tries: 3, ok: 2, lastAt: 1 } }
    expect(earnedBadges(doc)).not.toContain('tricky-tamer')

    doc.reading.practice = { fox: { tries: 3, ok: 3, lastAt: 1 } }
    expect(earnedBadges(doc)).toContain('tricky-tamer')
  })
})

describe('earnedBadges - collection', () => {
  it('first-card fires as soon as any card is owned', () => {
    const doc: ProgressDoc = defaultDoc()
    expect(earnedBadges(doc)).not.toContain('first-card')
    doc.collection.items = [owned('quartz')]
    expect(earnedBadges(doc)).toContain('first-card')
  })

  it('a set badge only fires once every card in that set is owned', () => {
    const doc: ProgressDoc = defaultDoc()
    const gemCards = itemsInSet('gems')
    expect(gemCards.length).toBeGreaterThan(0)

    doc.collection.items = gemCards.slice(0, -1).map((c) => owned(c.id))
    expect(earnedBadges(doc)).not.toContain('set-gems')

    doc.collection.items = gemCards.map((c) => owned(c.id))
    expect(earnedBadges(doc)).toContain('set-gems')
    expect(earnedBadges(doc)).not.toContain('set-animals')
  })

  it('first-legendary fires only once a legendary-rarity card is owned', () => {
    const doc: ProgressDoc = defaultDoc()
    doc.collection.items = [owned('quartz')] // common, not legendary
    expect(earnedBadges(doc)).not.toContain('first-legendary')

    doc.collection.items = [owned('quartz'), owned('andromeda-galaxy')]
    expect(earnedBadges(doc)).toContain('first-legendary')
  })
})

describe('BADGES catalogue', () => {
  it('every earnedBadges id is on the catalogue and every catalogue entry has a title/emoji/how', () => {
    const catalogueIds = new Set(BADGES.map((b) => b.id))
    for (const b of BADGES) {
      expect(b.title.length).toBeGreaterThan(0)
      expect(b.emoji.length).toBeGreaterThan(0)
      expect(b.how.length).toBeGreaterThan(0)
    }
    expect(catalogueIds.size).toBe(BADGES.length)
  })
})
