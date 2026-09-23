import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFeedbackInput,
  coachStatus,
  containsBannedContent,
  getCoachStage,
  kidTextViolates,
  MAX_PRAISE_CHARS,
  requestReadingFeedback,
  tidyCoachText,
  validateReadingFeedback,
  type CoachDeps,
} from '../readingCoach'
import { getDoc, resetAll, update, type EarResult, type ReadingTake, type TakeScore } from '../progress'
import { saveTake, setTakeAi, setTakeEar, setTakeScore } from '../reading'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

const SCRIPT_CFG = { scriptUrl: 'https://script.google.com/exec', secret: 'shh', folderName: 'Read Aloud takes' }
const PASSAGE_ID = 'l1-cat-nap' // "The cat sat. The cat has a nap." (8 words)

function enableDrive(): void {
  update('settings', (s) => ({ ...s, driveUpload: SCRIPT_CFG }))
}

function immediateSleep(): CoachDeps['sleep'] {
  return async () => {}
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20))
}

let n = 0
function makeTake(overrides: Partial<ReadingTake> = {}): ReadingTake {
  n++
  return {
    id: `take-${n}`,
    day: '2026-09-20',
    passageId: PASSAGE_ID,
    startedAt: Date.now() + n,
    durationSec: 20,
    mimeType: 'audio/mp4',
    sizeBytes: 1000,
    hasAudio: true,
    deviceId: 'device-1',
    ...overrides,
  }
}

function makeScore(overrides: Partial<TakeScore> = {}): TakeScore {
  return {
    outcome: 'full',
    stars: 3,
    attempted: 8,
    read: 6,
    stumbled: 1,
    different: 1,
    skipped: 0,
    accuracy: 0.875,
    cleanAccuracy: 0.75,
    coverage: 1,
    wcpm: 80,
    trickyWords: ['sat', 'a'],
    newPassageBest: false,
    ...overrides,
  }
}

function makeEar(overrides: Partial<EarResult> = {}): EarResult {
  return {
    words: [
      { i: 2, w: 'sat', s: 'stumbled' },
      { i: 6, w: 'a', s: 'different', heard: 'an' },
    ],
    extraWords: [],
    readSeconds: 15,
    confidence: 0.9,
    transcript: 'the cat sat the cat has a nap',
    at: Date.now(),
    ...overrides,
  }
}

/** Saves a fully scored take of the built-in passage and returns it. */
function seedScoredTake(overrides: Partial<ReadingTake> = {}, scoreOverrides: Partial<TakeScore> = {}, earOverrides: Partial<EarResult> = {}): ReadingTake {
  const take = makeTake(overrides)
  saveTake(take)
  setTakeScore(take.id, makeScore(scoreOverrides))
  setTakeEar(take.id, makeEar(earOverrides))
  return getDoc().reading.takes.find((t) => t.id === take.id)!
}

function claudeOkBody(overrides: Partial<{ praise: string; tryNext: string; trickyWords: string[]; note: string }> = {}) {
  return {
    ok: true,
    model: 'claude-opus-5',
    result: {
      kid: {
        praise: overrides.praise ?? 'You read almost every word today, nice job!',
        tryNext: overrides.tryNext ?? 'Want to try it again tomorrow?',
        trickyWords: overrides.trickyWords ?? ['sat'],
      },
      parent: { note: overrides.note ?? 'She read most words correctly today with good pace, a strong session overall for this level.' },
    },
  }
}

function okFetch(body: Record<string, unknown>): CoachDeps['fetch'] {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as CoachDeps['fetch']
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
  resetAll()
  n = 0
})

describe('tidyCoachText', () => {
  it('tidies dashes and curly quotes, collapses whitespace', () => {
    expect(tidyCoachText('steady — and calm')).toBe('steady - and calm')
    expect(tidyCoachText('“Cat Nap” is fun')).toBe('"Cat Nap" is fun')
    expect(tidyCoachText('plain text stays  the same ')).toBe('plain text stays the same')
  })
})

describe('containsBannedContent / kidTextViolates', () => {
  it('rejects a banned word as a whole word only ("bad" rejected, "badge" allowed)', () => {
    expect(containsBannedContent('That was a bad try today.')).toBe(true)
    expect(containsBannedContent('You earned a reading badge today.')).toBe(false)
  })

  it('rejects "I heard" but accepts "the app heard"', () => {
    expect(containsBannedContent('I heard you read so well today!')).toBe(true)
    expect(containsBannedContent('The app heard six of eight words clearly.')).toBe(false)
  })

  it('rejects a percent sign, wpm, and numbers over ten, but allows small numbers', () => {
    expect(kidTextViolates('You got 100% of the words!')).toBe(true)
    expect(kidTextViolates('You read at 42 wpm today!')).toBe(true)
    expect(kidTextViolates('You read 42 words today!')).toBe(true)
    expect(kidTextViolates('You read 7 tricky words today!')).toBe(false)
    expect(kidTextViolates('You read so well today!')).toBe(false)
  })
})

describe('validateReadingFeedback', () => {
  const passageWords = ['The', 'cat', 'sat.', 'The', 'cat', 'has', 'a', 'nap.']

  it('accepts a well-formed reply and normalizes tricky words to the passage spelling', () => {
    const validated = validateReadingFeedback(claudeOkBody().result, passageWords)
    expect(validated).not.toBeNull()
    expect(validated?.praise).toBeTruthy()
    expect(validated?.trickyWords).toEqual(['sat'])
  })

  it('returns null for a malformed shape', () => {
    expect(validateReadingFeedback({ kid: { praise: 'hi' } }, passageWords)).toBeNull()
    expect(validateReadingFeedback(null, passageWords)).toBeNull()
    expect(validateReadingFeedback('just a string', passageWords)).toBeNull()
  })

  it('rejects praise with a percent sign', () => {
    expect(validateReadingFeedback(claudeOkBody({ praise: 'You got 100% today!' }).result, passageWords)).toBeNull()
  })

  it('rejects tryNext containing "wpm"', () => {
    expect(validateReadingFeedback(claudeOkBody({ tryNext: 'Try to hit 60 wpm next time?' }).result, passageWords)).toBeNull()
  })

  it('rejects praise with a number over ten but allows one under ten', () => {
    expect(validateReadingFeedback(claudeOkBody({ praise: 'You read 42 whole words today, amazing!' }).result, passageWords)).toBeNull()
    expect(validateReadingFeedback(claudeOkBody({ praise: 'You read 7 whole words today, amazing!' }).result, passageWords)).not.toBeNull()
  })

  it('rejects a banned word in the parent note', () => {
    expect(validateReadingFeedback(claudeOkBody({ note: 'That was a bad session but okay overall for now.' }).result, passageWords)).toBeNull()
  })

  it('rejects praise over the character cap', () => {
    expect(validateReadingFeedback(claudeOkBody({ praise: 'x'.repeat(MAX_PRAISE_CHARS + 10) }).result, passageWords)).toBeNull()
  })

  it('filters trickyWords to the passage, dedupes, and caps at 3', () => {
    const validated = validateReadingFeedback(
      claudeOkBody({ trickyWords: ['sat', 'sat.', 'nap', 'dog', 'cat', 'has'] }).result,
      passageWords,
    )
    expect(validated?.trickyWords.length).toBe(3)
  })

  it('returns an empty trickyWords list when nothing matches the passage (caller falls back to score.trickyWords)', () => {
    const validated = validateReadingFeedback(claudeOkBody({ trickyWords: ['dog', 'fish'] }).result, passageWords)
    expect(validated?.trickyWords).toEqual([])
  })
})

describe('buildFeedbackInput', () => {
  it('returns null for a take with no score/ear yet', () => {
    const take = makeTake()
    saveTake(take)
    expect(buildFeedbackInput(getDoc().reading.takes[0], getDoc())).toBeNull()
  })

  it('fills passage, counts, and never includes a transcript field', () => {
    const take = seedScoredTake()
    const input = buildFeedbackInput(take, getDoc())
    expect(input).not.toBeNull()
    expect(input?.passageTitle).toBe('Cat Nap')
    expect(input?.level).toBe(1)
    expect(input?.thisTake.accuracyPct).toBe(88)
    expect(input?.thisTake.coveragePct).toBe(100)
    expect(input?.thisTake.readSeconds).toBe(15)
    expect(input?.thisTake.trickyCandidates.length).toBe(2)
    expect(JSON.stringify(input)).not.toMatch(/transcript/i)
  })

  it('caps previousReads at 5, oldest first, and numbers this take correctly', () => {
    let last: ReadingTake | undefined
    for (let i = 0; i < 6; i++) {
      last = seedScoredTake({ startedAt: 1000 * (i + 1), day: `2026-09-${String(i + 1).padStart(2, '0')}` })
    }
    const input = buildFeedbackInput(last!, getDoc())!
    expect(input.previousReads.length).toBe(5)
    expect(input.previousReads[0].day).toBe('2026-09-01') // oldest of the 5 earlier reads
    expect(input.previousReads[4].day).toBe('2026-09-05')
    expect(input.thisTake.takeNumberForThisPassage).toBe(6)
  })

  it('counts readsTodaySoFar excluding noReading takes', () => {
    seedScoredTake({ day: '2026-09-20' }, { outcome: 'noReading', stars: 0, attempted: 0, read: 0, stumbled: 0, different: 0, skipped: 8, accuracy: 0, cleanAccuracy: 0, coverage: 0, wcpm: 0, trickyWords: [] })
    seedScoredTake({ day: '2026-09-20' })
    const last = seedScoredTake({ day: '2026-09-20' })
    const input = buildFeedbackInput(last, getDoc())!
    expect(input.readsTodaySoFar).toBe(2)
  })
})

describe('requestReadingFeedback', () => {
  it('is a no-op when the take has no score/ear yet', async () => {
    const take = makeTake()
    saveTake(take)
    await requestReadingFeedback(take.id)
    expect(getDoc().reading.takes.find((t) => t.id === take.id)?.ai).toBeUndefined()
  })

  it('writes rules feedback immediately and keeps it when Drive is not configured (no fetch)', async () => {
    const take = seedScoredTake()
    const fetchFn = vi.fn()
    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn as unknown as CoachDeps['fetch'] })

    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.ai?.source).toBe('rules')
    expect(saved.ai?.kid?.praise).toBeTruthy()
    expect(saved.ai?.parent?.note).toBeTruthy()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(getCoachStage(take.id)).toBe('done')
  })

  it('keeps rules and never fetches when aiCoach.enabled is false, even with Drive configured', async () => {
    enableDrive()
    update('settings', (s) => ({ ...s, aiCoach: { enabled: false } }))
    const take = seedScoredTake()
    const fetchFn = vi.fn()

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn as unknown as CoachDeps['fetch'] })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(getDoc().reading.takes.find((t) => t.id === take.id)?.ai?.source).toBe('rules')
  })

  it('replaces rules with a valid Claude result', async () => {
    enableDrive()
    const take = seedScoredTake()
    const fetchFn = okFetch(claudeOkBody({ praise: 'Great steady reading today!' }))

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn })

    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.ai?.source).toBe('claude')
    expect(saved.ai?.model).toBe('claude-opus-5')
    expect(saved.ai?.kid?.praise).toBe('Great steady reading today!')
    expect(getCoachStage(take.id)).toBe('done')
  })

  it('sends the secret/action/system/user/schema shape, with no transcript field in the user text', async () => {
    enableDrive()
    const take = seedScoredTake()
    const fetchFn = okFetch(claudeOkBody())

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn })

    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(SCRIPT_CFG.scriptUrl)
    const payload = JSON.parse(init.body as string)
    expect(payload.secret).toBe(SCRIPT_CFG.secret)
    expect(payload.action).toBe('coach')
    expect(typeof payload.system).toBe('string')
    expect(typeof payload.user).toBe('string')
    expect(payload.schema).toBeTruthy()
    expect(payload.user.toLowerCase()).not.toMatch(/transcript/)
  })

  it('keeps rules when Claude returns an invalid shape', async () => {
    enableDrive()
    const take = seedScoredTake()
    const fetchFn = okFetch({ ok: true, model: 'claude-opus-5', result: { kid: { praise: 'hi' } } })

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn })

    expect(getDoc().reading.takes.find((t) => t.id === take.id)?.ai?.source).toBe('rules')
  })

  it('falls back to score.trickyWords when Claude\'s trickyWords list matches nothing in the passage', async () => {
    enableDrive()
    const take = seedScoredTake()
    const fetchFn = okFetch(claudeOkBody({ trickyWords: ['dog', 'fish'] }))

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn })

    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.ai?.source).toBe('claude')
    expect(saved.ai?.kid?.trickyWords).toEqual(take.score!.trickyWords)
  })

  it('schedules exactly one retry after a transient failure (cap), which then succeeds', async () => {
    enableDrive()
    const take = seedScoredTake()
    let call = 0
    const fetchFn = vi.fn(async () => {
      call += 1
      if (call === 1) return new Response(JSON.stringify({ ok: false, reason: 'cap' }), { status: 200 })
      return new Response(JSON.stringify(claudeOkBody({ praise: 'Retried and it worked out great!' })), { status: 200 })
    }) as unknown as CoachDeps['fetch']

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn, sleep: immediateSleep() })
    expect(getDoc().reading.takes.find((t) => t.id === take.id)?.ai?.source).toBe('rules')

    await flush()

    expect(fetchFn).toHaveBeenCalledTimes(2)
    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.ai?.source).toBe('claude')
    expect(saved.ai?.kid?.praise).toBe('Retried and it worked out great!')
  })

  it('does not retry a non-transient failure like http-404', async () => {
    enableDrive()
    const take = seedScoredTake()
    const fetchFn = okFetch({ ok: false, reason: 'http-404' })

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn, sleep: immediateSleep() })
    await flush()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(getDoc().reading.takes.find((t) => t.id === take.id)?.ai?.source).toBe('rules')
  })

  it('is a no-op on a second call without force once ai already exists', async () => {
    const take = seedScoredTake()
    const fetchFn = vi.fn()
    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn as unknown as CoachDeps['fetch'] })
    const firstAi = getDoc().reading.takes.find((t) => t.id === take.id)?.ai

    await requestReadingFeedback(take.id, undefined, { fetch: fetchFn as unknown as CoachDeps['fetch'] })

    expect(getDoc().reading.takes.find((t) => t.id === take.id)?.ai).toEqual(firstAi)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('force re-requests even when ai.source is already claude', async () => {
    enableDrive()
    const take = seedScoredTake()
    setTakeAi(take.id, { kid: { praise: 'old', tryNext: 'old', trickyWords: [] }, parent: { note: 'old' }, source: 'claude', model: 'claude-opus-5', at: 1 })
    const fetchFn = okFetch(claudeOkBody({ praise: 'Brand new praise this time!' }))

    await requestReadingFeedback(take.id, { force: true }, { fetch: fetchFn })

    const saved = getDoc().reading.takes.find((t) => t.id === take.id)!
    expect(saved.ai?.kid?.praise).toBe('Brand new praise this time!')
    expect(fetchFn).toHaveBeenCalled()
  })
})

describe('coachStatus', () => {
  it('reports not configured when Drive is not set up', async () => {
    const result = await coachStatus()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not-configured')
  })

  it('maps a full read-status response', async () => {
    enableDrive()
    const fetchFn = okFetch({
      ok: true,
      hasGeminiKey: true,
      geminiModel: 'gemini-3.8-flash',
      geminiOk: true,
      geminiError: '',
      hasClaudeKey: true,
      claudeOk: true,
      claudeError: '',
      readUsedToday: 3,
      readCap: 60,
      coachUsedToday: 2,
      coachCap: 80,
      lookupUsedToday: 0,
      lookupCap: 20,
    })

    const result = await coachStatus({ fetch: fetchFn })

    expect(result.ok).toBe(true)
    expect(result.geminiModel).toBe('gemini-3.8-flash')
    expect(result.readCap).toBe(60)
    expect(result.coachUsedToday).toBe(2)
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).action).toBe('read-status')
  })

  it('reports a network failure', async () => {
    enableDrive()
    const fetchFn = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as CoachDeps['fetch']

    const result = await coachStatus({ fetch: fetchFn })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('offline')
  })
})
