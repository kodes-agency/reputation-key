import { describe, expect, it } from 'vitest'
import { compareRuns, scoreSlice } from './review-analysis-v3-metrics'
import {
  acceptedResult,
  answer,
  mention,
  scoredRun,
  simpleCauseKey,
  unusableResult,
} from './review-analysis-v3.test-fixtures'

const air = mention({ topic: 'facilities_equipment', thing: 'air conditioning' })
const staff = mention({ topic: 'staff_service', thing: 'waiter', polarity: 'positive' })
const price = mention({ topic: 'price_billing', thing: 'bill', polarity: 'negative' })

describe('sentiment', () => {
  const runs = [
    scoredRun(
      'a',
      answer([], { sentiment: 'positive' }),
      acceptedResult('a', answer([], { sentiment: 'positive' })),
    ),
    scoredRun(
      'b',
      answer([], { sentiment: 'negative' }),
      acceptedResult('b', answer([], { sentiment: 'mixed' })),
    ),
    scoredRun(
      'c',
      answer([], { sentiment: 'negative' }),
      acceptedResult('c', answer([], { sentiment: 'negative' })),
    ),
    scoredRun('d', answer([], { sentiment: 'neutral' }), unusableResult('d', 'refused')),
  ]

  const scores = scoreSlice(runs, simpleCauseKey).sentiment

  it('is the share of reviews given the gold sentiment, a refusal counting as wrong', () => {
    expect(scores.accuracy).toBe(0.5)
  })

  it('reports each class, and a refused review lowers recall without adding a false positive', () => {
    expect(scores.perClass.positive.f1).toBe(1)
    expect(scores.perClass.negative).toMatchObject({ tp: 1, fp: 0, fn: 1 })
    expect(scores.perClass.mixed).toMatchObject({ tp: 0, fp: 1, fn: 0 })
    expect(scores.perClass.neutral).toMatchObject({ tp: 0, fp: 0, fn: 1 })
  })

  it('averages the F1 of the classes that exist', () => {
    // positive 1, negative 2/3, mixed 0, neutral 0.
    expect(scores.macroF1).toBeCloseTo((1 + 2 / 3 + 0 + 0) / 4, 12)
  })
})

describe('topics', () => {
  const runs = [
    scoredRun('a', answer([air, staff]), acceptedResult('a', answer([air, price]))),
    scoredRun('b', answer([air]), acceptedResult('b', answer([air]))),
    scoredRun('c', answer([staff]), unusableResult('c', 'output_invalid')),
  ]

  const topics = scoreSlice(runs, simpleCauseKey).topics

  it('scores the topics of each review as a set', () => {
    expect(topics.micro).toMatchObject({ tp: 2, fp: 1, fn: 2 })
    expect(topics.micro.f1).toBeCloseTo(4 / 7, 12)
  })

  it('reports each topic with the reviews that hold it', () => {
    expect(topics.perTopic.facilities_equipment).toMatchObject({
      support: 2,
      tp: 2,
      f1: 1,
    })
    expect(topics.perTopic.staff_service).toMatchObject({
      support: 2,
      tp: 0,
      fn: 2,
      f1: 0,
    })
  })

  it('names the weakest topic that has gold support', () => {
    expect(topics.weakest).toEqual({ topic: 'staff_service', f1: 0 })
  })

  it('does not hold an unsupported topic against the weakest, but lists it', () => {
    expect(topics.perTopic.price_billing).toMatchObject({ support: 0, fp: 1, f1: 0 })
    expect(topics.unsupportedTopicsPredicted).toEqual(['price_billing'])
  })

  it('has no weakest topic when the gold holds none', () => {
    const empty = scoreSlice(
      [scoredRun('a', answer([]), acceptedResult('a', answer([price])))],
      simpleCauseKey,
    )

    expect(empty.topics.weakest).toBeNull()
  })
})

describe('urgent', () => {
  const safetyGold = answer([air], { urgent: { reason: 'safety' } })
  const legalGold = answer([], { urgent: { reason: 'legal_threat' } })
  const quiet = answer([air])
  const runs = [
    // Found, but given the wrong reason.
    scoredRun(
      'safety',
      safetyGold,
      acceptedResult('safety', answer([air], { urgent: { reason: 'health' } })),
    ),
    // Missed: the answer says nothing.
    scoredRun('legal', legalGold, acceptedResult('legal', quiet)),
    // A near miss the answer wrongly raises.
    scoredRun(
      'near',
      quiet,
      acceptedResult('near', answer([air], { urgent: { reason: 'safety' } })),
      {
        tags: ['urgent_nearmiss'],
      },
    ),
    scoredRun('fine', quiet, acceptedResult('fine', quiet)),
    scoredRun('near-ok', quiet, acceptedResult('near-ok', quiet), {
      tags: ['urgent_nearmiss'],
    }),
  ]

  const urgent = scoreSlice(runs, simpleCauseKey).urgent

  it('reads recall and precision over the urgent reviews', () => {
    expect(urgent).toMatchObject({ goldUrgent: 2, predictedUrgent: 2, detected: 1 })
    expect(urgent.recall).toBe(0.5)
    expect(urgent.precision).toBe(0.5)
  })

  it('counts the safety and health cases the answer missed', () => {
    expect(urgent.safetyHealthCases).toBe(1)
    expect(urgent.safetyHealthMisses).toBe(0)
  })

  it('reads the false urgent rate over the reviews that are not urgent', () => {
    expect(urgent).toMatchObject({ nonUrgentItems: 3, falseUrgent: 1 })
    expect(urgent.falseUrgentRate).toBeCloseTo(1 / 3, 12)
  })

  it('reads specificity over the near misses', () => {
    expect(urgent).toMatchObject({ nearMissItems: 2, nearMissFalseUrgent: 1 })
    expect(urgent.nearMissSpecificity).toBe(0.5)
  })

  it('lays out the reasons as a matrix and scores the reason of the urgent reviews found', () => {
    expect(urgent.confusion).toEqual({
      legal_threat: { none: 1 },
      none: { none: 2, safety: 1 },
      safety: { health: 1 },
    })
    expect(urgent.reasonAccuracyWhenDetected).toBe(0)
  })

  it('counts a safety case the answer missed', () => {
    const missed = scoreSlice(
      [scoredRun('safety', safetyGold, acceptedResult('safety', quiet))],
      simpleCauseKey,
    ).urgent

    expect(missed.safetyHealthMisses).toBe(1)
    expect(missed.recall).toBe(0)
  })

  it('treats an answer that failed as an urgent review nobody saw', () => {
    const failed = scoreSlice(
      [scoredRun('safety', safetyGold, unusableResult('safety', 'truncated'))],
      simpleCauseKey,
    ).urgent

    expect(failed.safetyHealthMisses).toBe(1)
  })

  it('has no recall when the gold holds no urgent review', () => {
    const none = scoreSlice(
      [scoredRun('fine', quiet, acceptedResult('fine', quiet))],
      simpleCauseKey,
    )

    expect(none.urgent.recall).toBeNull()
    expect(none.urgent.safetyHealthCases).toBe(0)
  })
})

describe('robustness', () => {
  const runs = [
    scoredRun(
      'a',
      answer([air]),
      acceptedResult('a', answer([air]), {
        flags: ['mentions_capped', 'enum_case_repaired'],
        droppedMentionCount: 2,
        latencyMillis: 100,
        usage: { inputTokens: 500, outputTokens: 80 },
      }),
    ),
    scoredRun(
      'b',
      answer([air]),
      acceptedResult('b', answer([air]), {
        flags: ['sentence_refs_capped'],
        latencyMillis: 300,
        usage: { inputTokens: 700, outputTokens: 120 },
      }),
    ),
    scoredRun('c', answer([air]), unusableResult('c', 'refused')),
    scoredRun('d', answer([air]), unusableResult('d', 'redaction_blocked')),
  ]

  const robustness = scoreSlice(runs, simpleCauseKey).robustness

  it('counts what became of each review', () => {
    expect(robustness.items).toBe(4)
    expect(robustness.byStatus).toEqual({ accepted: 2, redaction_blocked: 1, refused: 1 })
    expect(robustness.usableRate).toBe(0.5)
  })

  it('counts the repairs the normalizer made', () => {
    expect(robustness.droppedMentions).toBe(2)
    expect(robustness.flagCounts).toEqual({
      enum_case_repaired: 1,
      mentions_capped: 1,
      sentence_refs_capped: 1,
    })
    expect(robustness.capEvents).toBe(2)
  })

  it('sums the tokens and reads the latency of the calls that were made', () => {
    expect(robustness.inputTokens).toBe(1200)
    expect(robustness.outputTokens).toBe(200)
    expect(robustness.meanLatencyMillis).toBe(200)
    expect(robustness.maxLatencyMillis).toBe(300)
  })
})

describe('compareRuns', () => {
  const first = [
    acceptedResult('a', answer([air])),
    acceptedResult('b', answer([air, staff])),
    acceptedResult('c', answer([air], { urgent: { reason: 'safety' } })),
    acceptedResult('d', answer([air])),
  ]
  const second = [
    acceptedResult('a', answer([air])),
    acceptedResult('b', answer([air])),
    acceptedResult('c', answer([air])),
    unusableResult('d', 'failed'),
  ]

  it('counts the reviews whose label, topics, urgent reason or status moved', () => {
    expect(compareRuns(first, second)).toEqual({
      items: 4,
      differentLabels: 3,
      differentTopicSets: 2,
      differentUrgent: 1,
      differentStatus: 1,
      labelDisagreementRate: 0.75,
    })
  })

  it('finds no disagreement between a run and itself', () => {
    expect(compareRuns(first, first)).toMatchObject({
      differentLabels: 0,
      labelDisagreementRate: 0,
    })
  })

  it('has no rate over no reviews', () => {
    expect(compareRuns([], []).labelDisagreementRate).toBeNull()
  })
})
