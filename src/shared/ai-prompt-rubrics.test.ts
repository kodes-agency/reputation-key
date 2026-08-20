import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AI_OPERATION_PROFILES } from './ai-operation-profiles'
import {
  AI_ANALYSIS_OUTPUT_SCHEMA,
  AI_PRIMARY_CATEGORIES,
  AI_REPLY_TEMPLATE_IDS,
  AI_SENTIMENTS,
  CONCRETE_REPLY_LANGUAGE_PATTERN,
} from './openai-route-output-schemas'

type Vector = Readonly<{
  vectorId: string
  reviewText: string
  rating: number
  languageCode: string
  expectedTemplateId: (typeof AI_REPLY_TEMPLATE_IDS)[number]
  rationale: string
}>

const vectors = JSON.parse(
  readFileSync(new URL('./ai-reply-selection-v1.vectors.json', import.meta.url), 'utf8'),
) as readonly Vector[]

function promptFor(profileVersion: string): string {
  const profile = AI_OPERATION_PROFILES.find((p) => p.profileVersion === profileVersion)
  if (!profile) throw new Error(`no profile ${profileVersion}`)
  return profile.developerPrompt
}

/**
 * The band the schema actually enforces, discovered by probing rather than
 * restated. If `superRefine` moves, these move with it and the prompt
 * assertions below fail until the instruction is corrected too.
 */
function acceptedValenceRange(
  sentiment: (typeof AI_SENTIMENTS)[number],
): Readonly<{ min: number; max: number }> {
  const accepted: number[] = []
  for (let valence = -100; valence <= 100; valence += 1) {
    const result = AI_ANALYSIS_OUTPUT_SCHEMA.safeParse({
      sentiment,
      sentimentValence: valence,
      primaryCategory: AI_PRIMARY_CATEGORIES[0],
      urgencySignals: [],
    })
    if (result.success) accepted.push(valence)
  }
  if (accepted.length === 0) throw new Error(`${sentiment} accepts no valence at all`)
  return { min: Math.min(...accepted), max: Math.max(...accepted) }
}

describe('analysis prompt states the bands its validator enforces', () => {
  const prompt = promptFor('review-analysis-v1')

  // The defect this pins: the schema rejected `positive` with valence 15 as
  // `output_invalid` AFTER the call was fully billed, while the prompt asked
  // only for "sentiment, integer valence" and never mentioned a band. A
  // constraint expressed solely in the validator is a billed failure mode.
  it('names the exact positive, neutral and negative boundaries', () => {
    const positive = acceptedValenceRange('positive')
    const neutral = acceptedValenceRange('neutral')
    const negative = acceptedValenceRange('negative')

    expect(prompt).toContain(String(positive.min))
    expect(prompt).toContain(String(neutral.min))
    expect(prompt).toContain(String(neutral.max))
    expect(prompt).toContain(String(negative.max))
  })

  it('names the overall valence range', () => {
    const mixed = acceptedValenceRange('mixed')
    expect(prompt).toContain(String(mixed.min))
    expect(prompt).toContain(String(mixed.max))
  })

  it('says mixed is unconstrained, because the validator exempts it', () => {
    const mixed = acceptedValenceRange('mixed')
    const positive = acceptedValenceRange('positive')
    // Guard the premise: if mixed ever gains a band, this test is wrong to
    // assert the prompt calls it unconstrained.
    expect(mixed.min).toBeLessThan(positive.min)
    expect(prompt.toLowerCase()).toContain('mixed accepts any value')
  })
})

describe('reply prompt states a rubric over the real template vocabulary', () => {
  const prompt = promptFor('reply-suggestion-v1')

  // The defect this pins: the model received four bare identifiers with no
  // description of what any template says, no rating or sentiment mapping and
  // no precedence rule. Everything downstream guaranteed the output was safe;
  // nothing guaranteed it was right.
  it('names every selectable template id', () => {
    for (const templateId of AI_REPLY_TEMPLATE_IDS) {
      expect(prompt).toContain(templateId)
    }
  })

  it('names no identifier that is not selectable', () => {
    const mentioned = prompt.match(/\b[a-z]+_[a-z_]+\b/gu) ?? []
    expect(mentioned.length).toBeGreaterThan(0)
    for (const token of new Set(mentioned)) {
      expect(AI_REPLY_TEMPLATE_IDS).toContain(token)
    }
  })

  it('states a precedence rule, because several conditions can co-apply', () => {
    expect(prompt.toLowerCase()).toContain('first rule that matches')
  })

  it('tells the model to ignore tone, which is applied after selection', () => {
    expect(prompt.toLowerCase()).toContain('ignore tone')
  })
})

describe('ai-reply-selection-v1 vectors', () => {
  it('is a non-trivial labelled set', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20)
  })

  it('has unique vector ids', () => {
    expect(new Set(vectors.map((v) => v.vectorId)).size).toBe(vectors.length)
  })

  it.each(vectors)('$vectorId is expressible on the wire', (vector) => {
    // Every field must be something the reply route can actually carry:
    // providerPayload is { reviewText, rating, languageCode, tone } and the
    // answer is validated against the template enum and the language pattern.
    expect(AI_REPLY_TEMPLATE_IDS).toContain(vector.expectedTemplateId)
    expect(vector.languageCode).toMatch(CONCRETE_REPLY_LANGUAGE_PATTERN)
    expect(Number.isInteger(vector.rating)).toBe(true)
    expect(vector.rating).toBeGreaterThanOrEqual(1)
    expect(vector.rating).toBeLessThanOrEqual(5)
    expect(vector.reviewText.trim().length).toBeGreaterThan(0)
    expect(vector.rationale.trim().length).toBeGreaterThan(0)
  })

  it('exercises every template id', () => {
    const covered = new Set(vectors.map((v) => v.expectedTemplateId))
    for (const templateId of AI_REPLY_TEMPLATE_IDS) {
      expect(covered).toContain(templateId)
    }
  })

  it('covers the precedence cases, not just the easy ones', () => {
    // A rubric is only worth having where rules collide. These are the cases
    // where rating and text disagree, or where praise and a service failure
    // appear in the same review.
    const precedence = vectors.filter((v) => v.rationale.startsWith('PRECEDENCE:'))
    expect(precedence.length).toBeGreaterThanOrEqual(2)
    // At least one must be a high rating that still selects a recovery reply,
    // which is exactly where a rating-keyed heuristic would go wrong.
    expect(
      precedence.some(
        (v) => v.rating >= 4 && v.expectedTemplateId === 'recovery_service',
      ),
    ).toBe(true)
  })

  it('covers more than one script', () => {
    const scripts = new Set(vectors.map((v) => v.languageCode.split('-')[1]))
    expect(scripts.size).toBeGreaterThanOrEqual(4)
  })
})
