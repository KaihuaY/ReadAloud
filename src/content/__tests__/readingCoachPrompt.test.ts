import { describe, expect, it } from 'vitest'
import {
  buildReadingFeedbackUser,
  READING_COACH_SYSTEM,
  READING_FEEDBACK_SCHEMA,
  type PreviousRead,
  type ReadingFeedbackInput,
  type TrickyCandidate,
} from '../readingCoachPrompt'

/** Recursively checks every `type: 'object'` node in a JSON schema carries additionalProperties:false and required matching its properties. */
function assertStrictObjects(schema: unknown): void {
  if (!schema || typeof schema !== 'object') return
  const node = schema as Record<string, unknown>
  if (node.type === 'object') {
    expect(node.additionalProperties).toBe(false)
    expect(Array.isArray(node.required)).toBe(true)
    const props = node.properties as Record<string, unknown> | undefined
    expect(props).toBeDefined()
    expect((node.required as string[]).sort()).toEqual(Object.keys(props!).sort())
  }
  const props = node.properties as Record<string, unknown> | undefined
  if (props) for (const v of Object.values(props)) assertStrictObjects(v)
  const items = node.items
  if (items) assertStrictObjects(items)
}

/** No numeric/length constraints anywhere - Anthropic's structured output doesn't support them. */
function assertNoLengthConstraints(schema: unknown): void {
  const json = JSON.stringify(schema)
  for (const forbidden of ['minLength', 'maxLength', 'minimum', 'maximum']) {
    expect(json).not.toContain(forbidden)
  }
}

describe('READING_COACH_SYSTEM', () => {
  it('is a non-empty string', () => {
    expect(typeof READING_COACH_SYSTEM).toBe('string')
    expect(READING_COACH_SYSTEM.length).toBeGreaterThan(200)
  })

  it('says "the app heard" and bans claiming Claude heard or listened', () => {
    expect(READING_COACH_SYSTEM).toContain('the app heard')
    expect(READING_COACH_SYSTEM).toMatch(/never (say|write).{0,40}"I heard"/i)
  })

  it('mentions trickyWords and percent', () => {
    expect(READING_COACH_SYSTEM).toContain('trickyWords')
    expect(READING_COACH_SYSTEM.toLowerCase()).toContain('percent')
  })

  it('praises stumbled words as a strategy, never a fault', () => {
    expect(READING_COACH_SYSTEM.toLowerCase()).toMatch(/stumbl.*(strategy|not a fault)/s)
  })

  it('calls different/skipped words "words to practise", never wrong', () => {
    expect(READING_COACH_SYSTEM).toContain('words to practise')
  })

  it('bans negative labels on her', () => {
    const lower = READING_COACH_SYSTEM.toLowerCase()
    for (const word of ['wrong', 'bad', 'mistake', 'lazy', 'slow']) {
      expect(lower).toContain(word) // named as banned
    }
  })
})

describe('READING_FEEDBACK_SCHEMA', () => {
  it('every object node has additionalProperties:false and required matching its properties', () => {
    assertStrictObjects(READING_FEEDBACK_SCHEMA)
  })

  it('never uses minLength/maxLength/minimum/maximum', () => {
    assertNoLengthConstraints(READING_FEEDBACK_SCHEMA)
  })

  it('shape matches { kid: { praise, tryNext, trickyWords }, parent: { note } }', () => {
    expect(READING_FEEDBACK_SCHEMA.required).toEqual(['kid', 'parent'])
    expect(READING_FEEDBACK_SCHEMA.properties.kid.required.slice().sort()).toEqual(['praise', 'tryNext', 'trickyWords'].sort())
    expect(READING_FEEDBACK_SCHEMA.properties.parent.required).toEqual(['note'])
    expect(READING_FEEDBACK_SCHEMA.properties.kid.properties.trickyWords.type).toBe('array')
    expect(READING_FEEDBACK_SCHEMA.properties.kid.properties.trickyWords.items.type).toBe('string')
  })
})

function tricky(word: string, status: TrickyCandidate['status'], heard?: string): TrickyCandidate {
  return { word, status, heard }
}

function baseInput(overrides: Partial<ReadingFeedbackInput> = {}): ReadingFeedbackInput {
  return {
    kidFirstName: 'Mia',
    age: 6,
    passageTitle: 'Cat and Hat',
    level: 1,
    focus: 'short a',
    passageWords: ['the', 'cat', 'sat', 'on', 'a', 'mat'],
    thisTake: {
      outcome: 'full',
      attempted: 6,
      read: 5,
      stumbled: 1,
      different: 0,
      skipped: 0,
      accuracyPct: 100,
      wcpm: 42,
      readSeconds: 12,
      coveragePct: 100,
      stars: 3,
      trickyCandidates: [],
      listenedFirst: true,
      takeNumberForThisPassage: 2,
    },
    previousReads: [],
    readsTodaySoFar: 1,
    streakDays: 3,
    ...overrides,
  }
}

describe('buildReadingFeedbackUser', () => {
  it('produces valid JSON carrying the kid, passage, and this take', () => {
    const parsed = JSON.parse(buildReadingFeedbackUser(baseInput())) as Record<string, unknown>
    expect(parsed.kidFirstName).toBe('Mia')
    expect(parsed.passageTitle).toBe('Cat and Hat')
    expect((parsed.thisTake as Record<string, unknown>).attempted).toBe(6)
  })

  it('slices previousReads to the last 5, even when more are passed', () => {
    const previousReads: PreviousRead[] = Array.from({ length: 8 }, (_, i) => ({
      day: `2026-09-0${i + 1}`,
      accuracyPct: 80 + i,
      wcpm: 30 + i,
      stars: 2,
      outcome: 'full',
    }))
    const parsed = JSON.parse(buildReadingFeedbackUser(baseInput({ previousReads }))) as { previousReads: PreviousRead[] }
    expect(parsed.previousReads).toHaveLength(5)
    expect(parsed.previousReads[4].day).toBe('2026-09-08')
  })

  it('never includes a transcript, audio, or dataBase64 key anywhere', () => {
    const input = baseInput({
      thisTake: {
        ...baseInput().thisTake,
        trickyCandidates: [tricky('cat', 'stumbled'), tricky('mat', 'different', 'map')],
      },
      previousReads: [{ day: '2026-09-01', accuracyPct: 80, wcpm: 30, stars: 2, outcome: 'full' }],
      passageBest: { wcpm: 40, accuracyPct: 95 },
    })
    const text = buildReadingFeedbackUser(input)
    JSON.parse(text) // still valid JSON
    const lower = text.toLowerCase()
    expect(lower).not.toContain('transcript')
    expect(lower).not.toContain('audio')
    expect(lower).not.toContain('database64')
  })

  it('includes passageBest when present and omits it when absent', () => {
    const withBest = JSON.parse(buildReadingFeedbackUser(baseInput({ passageBest: { wcpm: 40, accuracyPct: 95 } }))) as Record<string, unknown>
    expect(withBest.passageBest).toEqual({ wcpm: 40, accuracyPct: 95 })
    const withoutBest = JSON.parse(buildReadingFeedbackUser(baseInput())) as Record<string, unknown>
    expect(withoutBest.passageBest).toBeUndefined()
  })

  it('carries tricky candidates through untouched', () => {
    const input = baseInput({
      thisTake: {
        ...baseInput().thisTake,
        trickyCandidates: [tricky('mat', 'different', 'map')],
      },
    })
    const parsed = JSON.parse(buildReadingFeedbackUser(input)) as { thisTake: { trickyCandidates: TrickyCandidate[] } }
    expect(parsed.thisTake.trickyCandidates).toEqual([{ word: 'mat', status: 'different', heard: 'map' }])
  })
})
