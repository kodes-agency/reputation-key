import { describe, expect, it } from 'vitest'
import { REVIEW_ANALYSIS_V3_STORED_SCHEMA } from './review-analysis-v3'
import { normalizeReviewAnalysisV3 } from '#/shared/analysis/normalizer'

const context = {
  sentences: [
    'The invented dinner included several dishes.',
    'The invented drinks arrived later.',
    'The invented host welcomed us.',
  ],
}

function mention(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    topic: 'food_drink',
    polarity: 'negative',
    strength: 'clear',
    thing: 'food',
    issue: 'cold',
    sentences: [1],
    names_person: null,
    ...overrides,
  }
}

function normalize(mentions: readonly unknown[]) {
  const result = normalizeReviewAnalysisV3(
    { sentiment: 'mixed', mentions, urgent: null },
    context,
  )
  expect(result.status).toBe('normalized')
  if (result.status !== 'normalized') throw new Error('Expected a repairable answer')
  expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(result.answer).success).toBe(true)
  return result
}

describe('review analysis v3 duplicate repair', () => {
  it.each([false, true])(
    'keeps the strongest duplicate regardless of arrival order (strongest first: %s)',
    (strongestFirst) => {
      const weak = mention({ strength: 'mild', issue: 'too salty', sentences: [1] })
      const strong = mention({ strength: 'strong', issue: 'cold', sentences: [2] })
      const staff = mention({
        topic: 'staff_service',
        polarity: 'positive',
        thing: 'staff',
        issue: 'helpful',
        sentences: [3],
      })
      const result = normalize(
        strongestFirst ? [strong, staff, weak] : [weak, staff, strong],
      )

      expect(result.answer.mentions).toEqual([
        mention({ strength: 'strong', sentences: [1, 2] }),
        staff,
      ])
      expect(result.flags).toEqual(['mentions_merged'])
      expect(result.droppedMentionCount).toBe(0)
    },
  )

  it.each([false, true])(
    'preserves both polarities at equal strength (negative first: %s)',
    (negativeFirst) => {
      const negative = mention({ strength: 'strong', sentences: [1] })
      const positive = mention({
        polarity: 'positive',
        strength: 'strong',
        issue: 'tasty',
        sentences: [2],
      })
      const mentions = negativeFirst ? [negative, positive] : [positive, negative]
      const result = normalize(mentions)

      expect(result.answer.mentions).toEqual(mentions)
      expect(result.flags).toEqual([])
      expect(result.droppedMentionCount).toBe(0)
    },
  )

  it('keeps food and drinks distinct while repairing repeats within each cause', () => {
    const food = mention({ strength: 'strong' })
    const drinks = mention({ thing: 'drinks', issue: 'warm', sentences: [2] })
    const result = normalize([
      mention({ strength: 'mild', issue: 'too salty' }),
      drinks,
      food,
      drinks,
    ])

    expect(result.answer.mentions).toEqual([food, drinks])
    expect(result.flags).toEqual(['mentions_merged'])
    expect(result.droppedMentionCount).toBe(0)
  })

  it('repairs repeated valid mentions without accepting a malformed duplicate', () => {
    const valid = mention()
    const result = normalize([
      valid,
      mention({ strength: 'severe' }),
      valid,
      mention({ sentences: [99] }),
    ])

    expect(result.answer.mentions).toEqual([valid])
    expect(result.flags).toEqual([
      'mention_dropped_enum',
      'mention_dropped_sentences',
      'mentions_merged',
      'sentence_refs_repaired',
    ])
    expect(result.droppedMentionCount).toBe(2)
  })

  it('does not change a repaired answer when normalized again', () => {
    const repaired = normalize([
      mention({ strength: 'mild', sentences: [2] }),
      mention({ strength: 'strong', sentences: [1] }),
    ])
    const repeated = normalizeReviewAnalysisV3(repaired.answer, context)

    expect(repeated).toEqual({
      status: 'normalized',
      answer: repaired.answer,
      flags: [],
      droppedMentionCount: 0,
    })
  })
})
