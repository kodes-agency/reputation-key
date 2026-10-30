import { describe, expect, it } from 'vitest'
import {
  GATE_IDS,
  GATING_SLICES,
  RELEASE_GATES_V1,
  evaluateGates,
  type GateId,
  type GatingSlice,
} from './review-analysis-v3-gates'
import { scoreSlice, type SliceMetrics } from './review-analysis-v3-metrics'
import {
  acceptedResult,
  answer,
  mention,
  scoredRun,
  simpleCauseKey,
} from './review-analysis-v3.test-fixtures'

const air = mention({ topic: 'facilities_equipment', thing: 'air conditioning' })
const staff = mention({ topic: 'staff_service', thing: 'waiter', polarity: 'positive' })

/** A slice every gate can read and passes: two urgent reviews found, two quiet ones. */
function perfectSlice(): SliceMetrics {
  const safety = answer([air], { urgent: { reason: 'safety' } })
  const health = answer([staff], { urgent: { reason: 'health' } })
  const quiet = answer([air, staff])
  return scoreSlice(
    [
      scoredRun('a', safety, acceptedResult('a', safety)),
      scoredRun('b', health, acceptedResult('b', health)),
      scoredRun('c', quiet, acceptedResult('c', quiet)),
      scoredRun('d', quiet, acceptedResult('d', quiet)),
    ],
    simpleCauseKey,
  )
}

function slicesOf(
  patch: (slice: SliceMetrics, name: GatingSlice) => SliceMetrics = (slice) => slice,
): Record<GatingSlice, SliceMetrics> {
  return {
    all: patch(perfectSlice(), 'all'),
    en: patch(perfectSlice(), 'en'),
    bg: patch(perfectSlice(), 'bg'),
    es: patch(perfectSlice(), 'es'),
  }
}

function only(name: GatingSlice, change: (slice: SliceMetrics) => SliceMetrics) {
  return slicesOf((slice, current) => (current === name ? change(slice) : slice))
}

const statusOf = (
  slices: Record<GatingSlice, SliceMetrics>,
  gate: GateId,
  slice: GatingSlice,
) =>
  evaluateGates(slices).results.find((one) => one.gate === gate && one.slice === slice)
    ?.status

describe('the thresholds', () => {
  it('are the numbers of decision 6', () => {
    expect(RELEASE_GATES_V1).toMatchObject({
      urgentSafetyHealthMissesMax: 0,
      urgentRecallMin: 0.95,
      falseUrgentRateMax: 0.02,
      topicMicroF1Min: 0.85,
      topicF1Min: 0.7,
      thingAgreementMin: 0.7,
    })
  })

  it('are read for the whole set and for English, Bulgarian and Spanish', () => {
    expect(GATING_SLICES).toEqual(['all', 'en', 'bg', 'es'])
    expect(evaluateGates(slicesOf()).results).toHaveLength(
      GATING_SLICES.length * GATE_IDS.length,
    )
  })
})

describe('a provider that does everything right', () => {
  it('passes every gate in every slice', () => {
    const report = evaluateGates(slicesOf())

    expect(report.verdict).toBe('pass')
    expect(report.failures).toEqual([])
    expect(report.unmeasured).toEqual([])
    expect(report.results.every((result) => result.status === 'pass')).toBe(true)
  })
})

describe('the boundary of each gate', () => {
  it('passes exactly on a threshold and fails just past it', () => {
    const exactly = slicesOf((slice) => ({
      ...slice,
      urgent: { ...slice.urgent, recall: 0.95, falseUrgentRate: 0.02 },
      topics: {
        ...slice.topics,
        micro: { ...slice.topics.micro, f1: 0.85 },
        weakest: { topic: 'safety', f1: 0.7 },
      },
      mentions: {
        ...slice.mentions,
        causes: { ...slice.mentions.causes, thingAgreement: 0.7 },
      },
    }))
    const past = slicesOf((slice) => ({
      ...slice,
      urgent: { ...slice.urgent, recall: 0.949, falseUrgentRate: 0.0201 },
      topics: {
        ...slice.topics,
        micro: { ...slice.topics.micro, f1: 0.849 },
        weakest: { topic: 'safety', f1: 0.699 },
      },
      mentions: {
        ...slice.mentions,
        causes: { ...slice.mentions.causes, thingAgreement: 0.699 },
      },
    }))

    expect(evaluateGates(exactly).verdict).toBe('pass')
    const failed = evaluateGates(past)
    expect(failed.verdict).toBe('fail')
    expect([...new Set(failed.failures.map((result) => result.gate))].sort()).toEqual(
      [
        'thing_agreement',
        'topic_micro_f1',
        'topic_min_f1',
        'urgent_false_rate',
        'urgent_recall',
      ].sort(),
    )
  })

  it('allows no safety or health case to be missed, whatever the recall', () => {
    const slices = only('en', (slice) => ({
      ...slice,
      urgent: { ...slice.urgent, safetyHealthMisses: 1, recall: 0.97 },
    }))

    expect(statusOf(slices, 'urgent_safety_health_misses', 'en')).toBe('fail')
    expect(statusOf(slices, 'urgent_recall', 'en')).toBe('pass')
    expect(evaluateGates(slices).verdict).toBe('fail')
  })

  it('names the weakest topic in the note of the topic gate', () => {
    const slices = only('all', (slice) => ({
      ...slice,
      topics: { ...slice.topics, weakest: { topic: 'communication', f1: 0.5 } },
    }))

    const result = evaluateGates(slices).results.find(
      (one) => one.gate === 'topic_min_f1' && one.slice === 'all',
    )

    expect(result).toMatchObject({ status: 'fail', value: 0.5 })
    expect(result?.note).toContain('communication')
  })

  it('reads a language on its own', () => {
    const slices = only('bg', (slice) => ({
      ...slice,
      topics: { ...slice.topics, micro: { ...slice.topics.micro, f1: 0.5 } },
    }))

    expect(statusOf(slices, 'topic_micro_f1', 'bg')).toBe('fail')
    expect(statusOf(slices, 'topic_micro_f1', 'en')).toBe('pass')
    expect(statusOf(slices, 'topic_micro_f1', 'all')).toBe('pass')
  })
})

describe('the thing agreement gate', () => {
  const wifi = mention({
    topic: 'facilities_equipment',
    thing: 'wifi',
    issue: 'too slow',
  })

  /** Every review has two causes under one topic; the answer returns only the first. */
  function sliceMissingASecondCause(): SliceMetrics {
    const gold = answer([air, wifi])
    const found = answer([air])
    return scoreSlice(
      ['a', 'b', 'c', 'd'].map((id) => scoredRun(id, gold, acceptedResult(id, found))),
      simpleCauseKey,
    )
  }

  it('fails an answer that finds only one of two causes under a topic', () => {
    const slice = sliceMissingASecondCause()
    const report = evaluateGates({ all: slice, en: slice, bg: slice, es: slice })
    const result = report.results.find(
      (one) => one.gate === 'thing_agreement' && one.slice === 'all',
    )

    expect(slice.topics.micro.f1).toBe(1)
    expect(result).toMatchObject({ status: 'fail', value: 0.5 })
    expect(result?.note).toBe(
      '4 of 8 mentions agree: 4 paired, 4 only in the gold, 0 only in the answer',
    )
  })

  it('fails an answer that adds a cause the gold lacks', () => {
    const gold = answer([air])
    const crowded = answer([air, wifi])
    const slice = scoreSlice(
      ['a', 'b'].map((id) => scoredRun(id, gold, acceptedResult(id, crowded))),
      simpleCauseKey,
    )
    const report = evaluateGates({ all: slice, en: slice, bg: slice, es: slice })

    expect(report.results.find((one) => one.gate === 'thing_agreement')).toMatchObject({
      status: 'fail',
      value: 0.5,
    })
  })
})

describe('a gate over nothing', () => {
  const noUrgentCases = (slice: SliceMetrics): SliceMetrics => ({
    ...slice,
    urgent: {
      ...slice.urgent,
      goldUrgent: 0,
      detected: 0,
      recall: null,
      safetyHealthCases: 0,
      safetyHealthMisses: 0,
    },
  })

  it('is not measurable, and is neither a pass nor a failure', () => {
    const slices = only('bg', noUrgentCases)

    expect(statusOf(slices, 'urgent_recall', 'bg')).toBe('not_measurable')
    expect(statusOf(slices, 'urgent_safety_health_misses', 'bg')).toBe('not_measurable')
    expect(statusOf(slices, 'urgent_false_rate', 'bg')).toBe('pass')
  })

  it('does not stop a provider passing when only a language lacks urgent cases', () => {
    const report = evaluateGates(
      slicesOf((slice, name) =>
        name === 'all' || name === 'en' ? slice : noUrgentCases(slice),
      ),
    )

    expect(report.verdict).toBe('pass')
    expect(report.unmeasured.map((result) => `${result.slice} ${result.gate}`)).toEqual([
      'bg urgent_safety_health_misses',
      'bg urgent_recall',
      'es urgent_safety_health_misses',
      'es urgent_recall',
    ])
  })

  it('leaves the verdict incomplete when a gate cannot be read over the whole set', () => {
    const report = evaluateGates(slicesOf(noUrgentCases))

    expect(report.verdict).toBe('incomplete')
    expect(report.failures).toEqual([])
  })

  it('lets a failure outrank an incomplete reading', () => {
    const slices = slicesOf((slice, name) =>
      name === 'all'
        ? {
            ...noUrgentCases(slice),
            topics: { ...slice.topics, micro: { ...slice.topics.micro, f1: 0.1 } },
          }
        : slice,
    )

    expect(evaluateGates(slices).verdict).toBe('fail')
  })
})
