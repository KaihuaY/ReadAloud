import { describe, expect, it } from 'vitest'
import { bumpStreak, bumpStreakForgiving, dayOffset, formatClock, lastNDays, localDay } from '../sessions'
import type { Streak } from '../progress'

describe('localDay', () => {
  it('uses the local calendar day, not UTC', () => {
    expect(localDay(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07')
  })

  it('pads single-digit months and days', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('dayOffset', () => {
  it('moves forward and backward across a month boundary', () => {
    expect(dayOffset('2026-09-07', -1)).toBe('2026-09-06')
    expect(dayOffset('2026-09-01', -1)).toBe('2026-08-31')
    expect(dayOffset('2026-09-07', 1)).toBe('2026-09-08')
  })
})

describe('lastNDays', () => {
  it('returns n days ending at today, oldest first', () => {
    expect(lastNDays(3, '2026-09-07')).toEqual(['2026-09-05', '2026-09-06', '2026-09-07'])
  })
})

describe('bumpStreak', () => {
  it('starts a fresh streak at 1 from a blank streak', () => {
    expect(bumpStreak({ current: 0, best: 0, lastDay: '' }, '2026-09-07')).toEqual({
      current: 1,
      best: 1,
      lastDay: '2026-09-07',
    })
  })

  it('continues the streak when the last day was yesterday', () => {
    expect(bumpStreak({ current: 4, best: 4, lastDay: '2026-09-06' }, '2026-09-07')).toEqual({
      current: 5,
      best: 5,
      lastDay: '2026-09-07',
    })
  })

  it('leaves current unchanged when already logged today', () => {
    expect(bumpStreak({ current: 4, best: 6, lastDay: '2026-09-07' }, '2026-09-07')).toEqual({
      current: 4,
      best: 6,
      lastDay: '2026-09-07',
    })
  })

  it('restarts at 1 when a day was missed', () => {
    expect(bumpStreak({ current: 5, best: 5, lastDay: '2026-09-01' }, '2026-09-07')).toEqual({
      current: 1,
      best: 5,
      lastDay: '2026-09-07',
    })
  })
})

describe('formatClock', () => {
  it('formats M:SS, zero-padding seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
  })
})

describe('bumpStreakForgiving', () => {
  const today = '2026-09-10'

  it('continues the streak when the last read was yesterday, same as bumpStreak', () => {
    const streak: Streak = { current: 3, best: 3, lastDay: '2026-09-09' }
    expect(bumpStreakForgiving(streak, today)).toEqual({ current: 4, best: 4, lastDay: today })
  })

  it('leaves current unchanged when already read today', () => {
    const streak: Streak = { current: 3, best: 3, lastDay: today }
    expect(bumpStreakForgiving(streak, today)).toEqual({ current: 3, best: 3, lastDay: today })
  })

  it('forgives exactly one missed day when the freeze has not been used recently', () => {
    const streak: Streak = { current: 5, best: 5, lastDay: '2026-09-08' } // one day missed (the 9th)
    const next = bumpStreakForgiving(streak, today)
    expect(next).toEqual({ current: 6, best: 6, lastDay: today, freezeUsedOn: today })
  })

  it('does not forgive a one-day gap if the freeze was already used within the last 7 days', () => {
    const streak: Streak = { current: 5, best: 5, lastDay: '2026-09-08', freezeUsedOn: '2026-09-05' }
    const next = bumpStreakForgiving(streak, today)
    expect(next).toEqual({ current: 1, best: 5, lastDay: today, freezeUsedOn: '2026-09-05' })
  })

  it('forgives again once the freeze is more than 7 days stale', () => {
    const streak: Streak = { current: 5, best: 5, lastDay: '2026-09-08', freezeUsedOn: '2026-09-02' } // 8 days before today
    const next = bumpStreakForgiving(streak, today)
    expect(next).toEqual({ current: 6, best: 6, lastDay: today, freezeUsedOn: today })
  })

  it('restarts at 1 on a two-day (or wider) gap, even with an unused freeze', () => {
    const streak: Streak = { current: 5, best: 5, lastDay: '2026-09-07' } // two days missed
    const next = bumpStreakForgiving(streak, today)
    expect(next).toEqual({ current: 1, best: 5, lastDay: today, freezeUsedOn: undefined })
  })

  it('starts a fresh streak at 1 from a blank streak', () => {
    expect(bumpStreakForgiving({ current: 0, best: 0, lastDay: '' }, today)).toEqual({
      current: 1,
      best: 1,
      lastDay: today,
      freezeUsedOn: undefined,
    })
  })
})
