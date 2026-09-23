// The reading coach's offline fallback: built-in phrases used whenever
// Claude isn't reachable (no script URL, offline, the script has no API
// key, an error, a refusal, or invalid JSON back - see
// src/store/readingCoach.ts). Follows the exact same tone rules as
// src/content/readingCoachPrompt.ts's system prompt (process praise, never
// talent, stumbled words always praised, different/skipped words are
// "words to practise" and never "wrong", no comparisons with anyone but her
// own earlier reads, kid.praise <= 2 sentences, kid.tryNext exactly one
// invitation, parent.note 3-5 sentences with the real numbers) but picks
// from several pre-written variants instead of calling out anywhere. The
// variant for a given take is chosen by a stable hash of its id, so the
// same take always renders the same text.

import type { PassageBest, TakeScore } from '../store/progress'

export type PhraseSituation =
  | 'noReading'
  | 'unsure'
  | 'partial'
  | 'cleanRun'
  | 'smoother'
  | 'fewerTricky'
  | 'soundedOut'
  | 'generic'

export interface RulePhraseContext {
  /** Seeds the deterministic variant pick - pass the take's own id. */
  takeId: string
  kidFirstName: string
  passageTitle: string
  score: TakeScore
  /** Her previous take of this same passage, if any. */
  previous?: TakeScore
  passageBestBefore?: PassageBest
  level: number
  /** Recent accuracy values (0-1) for reads at the current level, for the level-hint sentence. */
  wordsAtLevelRecentAccuracy?: number[]
}

export interface RulePhraseResult {
  kid: { praise: string; tryNext: string; trickyWords: string[] }
  parent: { note: string }
  situation: PhraseSituation
}

// ---------------------------------------------------------------------------
// Deterministic pick
// ---------------------------------------------------------------------------

/** A small stable string hash (djb2), used to seed a deterministic variant pick from a take id. */
export function stableHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function pick<T>(variants: readonly T[], seed: number): T {
  return variants[seed % variants.length]
}

// ---------------------------------------------------------------------------
// Situation
// ---------------------------------------------------------------------------

/**
 * Picks which situation best describes this take, in priority order: a thin
 * outcome (noReading/unsure/partial) always wins first since those need
 * honest, careful wording regardless of the numbers; then a new personal
 * best; then a clean, accurate read; then fewer tricky words than her last
 * read of this passage; then a read built mostly on sounding words out;
 * otherwise generic.
 */
export function classifySituation(ctx: RulePhraseContext): PhraseSituation {
  const { score, previous } = ctx
  if (score.outcome === 'noReading') return 'noReading'
  if (score.outcome === 'unsure') return 'unsure'
  if (score.outcome === 'partial') return 'partial'
  if (score.newPassageBest) return 'smoother'
  if (score.accuracy >= 0.9) return 'cleanRun'
  if (previous && score.different + score.skipped < previous.different + previous.skipped) return 'fewerTricky'
  if (score.stumbled >= 2 && score.different === 0) return 'soundedOut'
  return 'generic'
}

// ---------------------------------------------------------------------------
// Kid praise / tryNext
// ---------------------------------------------------------------------------

function praiseFor(situation: PhraseSituation, ctx: RulePhraseContext, seed: number): string {
  const name = ctx.kidFirstName
  switch (situation) {
    case 'noReading': {
      const variants = [
        `You sat down and gave it a try today, ${name} - that is the hardest part!`,
        `You picked up the passage and got started, ${name}. That counts.`,
        `Trying today is what matters, ${name} - the words will come.`,
      ]
      return pick(variants, seed)
    }
    case 'unsure': {
      const variants = [
        `You gave this passage a real try today, ${name} - nice work sitting down with it.`,
        `You kept going through the whole passage, ${name}. That is worth being proud of.`,
      ]
      return pick(variants, seed)
    }
    case 'partial': {
      const variants = [
        `You read part of it today, ${name} - that is a good start on a tricky one.`,
        `You got going and read some of it, ${name}. Every bit you read counts.`,
        `Nice start, ${name} - you read some tricky words already today.`,
      ]
      return pick(variants, seed)
    }
    case 'smoother': {
      const variants = [
        `That was your smoothest read of this one yet, ${name} - way to go!`,
        `You just beat your own best read of this passage, ${name}. Nice work.`,
        `That read was smoother than ever before, ${name} - you can feel it getting easier.`,
      ]
      return pick(variants, seed)
    }
    case 'cleanRun': {
      const variants = [
        `You read almost every word today, ${name} - that is fantastic reading!`,
        `You got nearly every word right today, ${name}. All that practice is working.`,
        `That was a strong, clear read, ${name} - great job all the way through.`,
      ]
      return pick(variants, seed)
    }
    case 'fewerTricky': {
      const count = ctx.score.trickyWords.length
      const variants = [
        `Fewer tricky words this time, ${name} - only ${count} to practise now!`,
        `You are down to just ${count} tricky ${count === 1 ? 'word' : 'words'} on this one, ${name}.`,
      ]
      return pick(variants, seed)
    }
    case 'soundedOut': {
      const variants = [
        `You sounded out the hard words today, ${name} - that is exactly what a good reader does!`,
        `You stopped and sounded out the tricky parts, ${name}. That is a great strategy.`,
        `You worked through the tricky spots by sounding them out, ${name} - nice thinking.`,
      ]
      return pick(variants, seed)
    }
    default: {
      const variants = [
        `You read the whole passage today, ${name} - nice work sticking with it.`,
        `You gave this one a good, steady try today, ${name}.`,
      ]
      return pick(variants, seed)
    }
  }
}

function tryNextFor(situation: PhraseSituation, seed: number): string {
  switch (situation) {
    case 'noReading': {
      const variants = [
        `Want to try again holding the device a little closer next time?`,
        `How about giving it one more try, nice and close to the microphone?`,
      ]
      return pick(variants, seed)
    }
    case 'unsure': {
      const variants = [
        `Want to try that one again, a little slower and close to the microphone?`,
        `How about reading it once more so it comes through nice and clear?`,
      ]
      return pick(variants, seed)
    }
    case 'partial': {
      const variants = [
        `Want to try reading all the way to the end this time?`,
        `How about giving it one more go, all the way through?`,
      ]
      return pick(variants, seed)
    }
    case 'smoother': {
      const variants = [
        `Want to read it once more and see how smooth you can make it?`,
        `How about reading it again to feel just how far you have come?`,
      ]
      return pick(variants, seed)
    }
    case 'cleanRun': {
      const variants = [
        `Want to pick a new passage to try next?`,
        `How about trying a new story next time?`,
      ]
      return pick(variants, seed)
    }
    case 'fewerTricky': {
      const variants = [
        `Want to tap the sun words to hear them before you try again?`,
        `How about practising just those tricky words next?`,
      ]
      return pick(variants, seed)
    }
    case 'soundedOut': {
      const variants = [
        `Want to read it again and try sounding out those same words?`,
        `How about giving it another go with the same sounding-out trick?`,
      ]
      return pick(variants, seed)
    }
    default: {
      const variants = [
        `Want to read it once more and see how it feels?`,
        `How about listening first, then giving it another try?`,
        `Want to tap a word you're not sure of before you try again?`,
      ]
      return pick(variants, seed)
    }
  }
}

// ---------------------------------------------------------------------------
// Parent note
// ---------------------------------------------------------------------------

function outcomeSentence(situation: PhraseSituation, name: string, title: string): string {
  switch (situation) {
    case 'noReading':
      return `The app did not catch a real reading attempt from ${name} on "${title}" this time.`
    case 'unsure':
      return `The app was not fully confident about what it heard from ${name} on "${title}" this time.`
    case 'partial':
      return `${name} read part of "${title}" today before stopping.`
    default:
      return `${name} read "${title}" today.`
  }
}

function countsSentence(score: TakeScore): string {
  if (score.attempted === 0) {
    return `There was not enough of an attempt for the app to measure accuracy or speed this time.`
  }
  const correct = score.read + score.stumbled
  return `She read or sounded out ${correct} of ${score.attempted} words attempted, at about ${Math.round(score.wcpm)} words a minute.`
}

function trickyWordsSentence(score: TakeScore): string {
  if (score.trickyWords.length === 0) {
    return `There were no words to practise this time.`
  }
  return `The words to practise were: ${score.trickyWords.join(', ')}.`
}

function comparisonSentence(score: TakeScore, previous: TakeScore | undefined): string | undefined {
  if (!previous) return undefined
  if (score.accuracy > previous.accuracy) return `That is more accurate than her last read of this passage.`
  if (score.accuracy < previous.accuracy) return `That is a little less accurate than her last read of this passage - not unusual day to day.`
  if (score.wcpm > previous.wcpm) return `That is a faster pace than her last read of this passage.`
  return `That is about the same as her last read of this passage.`
}

/** Buckets a run of recent same-level accuracies into a level-change suggestion. */
export function levelHint(recentAccuracies: number[]): 'up' | 'down' | 'stay' {
  if (recentAccuracies.length >= 5 && recentAccuracies.every((v) => v >= 0.95)) return 'up'
  if (recentAccuracies.length >= 3 && recentAccuracies.every((v) => v < 0.6)) return 'down'
  return 'stay'
}

function levelSentence(level: number, hint: ReturnType<typeof levelHint>): string {
  if (hint === 'up') return `She has been reading level ${level} very accurately lately, so she might be ready to try level ${level + 1} soon.`
  if (hint === 'down') return `Level ${level} has been a stretch lately, so it might help to try a level down for now.`
  return `Level ${level} still looks like a good fit for her right now.`
}

function parentNoteFor(situation: PhraseSituation, ctx: RulePhraseContext): string {
  const sentences: string[] = []
  sentences.push(outcomeSentence(situation, ctx.kidFirstName, ctx.passageTitle))
  sentences.push(countsSentence(ctx.score))
  sentences.push(trickyWordsSentence(ctx.score))
  const comparison = comparisonSentence(ctx.score, ctx.previous)
  if (comparison) sentences.push(comparison)
  if (ctx.wordsAtLevelRecentAccuracy) {
    sentences.push(levelSentence(ctx.level, levelHint(ctx.wordsAtLevelRecentAccuracy)))
  }
  return sentences.slice(0, 5).join(' ')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Deterministic built-in feedback for one take, following the same tone
 * rules as the Claude prompt. The same `takeId` always renders the same
 * text.
 */
export function rulePhrases(ctx: RulePhraseContext): RulePhraseResult {
  const seed = stableHash(ctx.takeId)
  const situation = classifySituation(ctx)
  const trickyWords = situation === 'noReading' || situation === 'unsure' ? [] : ctx.score.trickyWords
  return {
    kid: {
      praise: praiseFor(situation, ctx, seed),
      tryNext: tryNextFor(situation, seed),
      trickyWords,
    },
    parent: { note: parentNoteFor(situation, ctx) },
    situation,
  }
}
