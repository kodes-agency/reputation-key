import { describe, expect, it } from 'vitest'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import {
  GATE_IDS,
  GATING_SLICES,
  RELEASE_GATES,
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

/** Reviews of each kind a slice holds, enough for the topic floor to read every topic in it. */
const QUIET_REVIEWS = RELEASE_GATES.topicF1MinSupport

/**
 * A slice every gate can read and passes: two urgent reviews found, and quiet ones. The topics
 * are facilities_equipment and staff_service, each in more reviews than the topic floor needs.
 */
function perfectSlice(): SliceMetrics {
  const safety = answer([air], { urgent: { reason: 'safety' } })
  const health = answer([staff], { urgent: { reason: 'health' } })
  const quiet = answer([air, staff])
  return scoreSlice(
    [
      scoredRun('a', safety, acceptedResult('a', safety)),
      scoredRun('b', health, acceptedResult('b', health)),
      ...Array.from({ length: QUIET_REVIEWS }, (_unused, index) =>
        scoredRun(`q${index}`, quiet, acceptedResult(`q${index}`, quiet)),
      ),
    ],
    simpleCauseKey,
  )
}

/** The slice with one topic's score and gold support set, as a provider's weak topic would leave it. */
function withTopic(
  slice: SliceMetrics,
  topic: ReviewTopicV3,
  f1: number,
  support: number,
): SliceMetrics {
  return {
    ...slice,
    topics: {
      ...slice.topics,
      perTopic: {
        ...slice.topics.perTopic,
        [topic]: { ...slice.topics.perTopic[topic], f1, support },
      },
    },
  }
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
  it('are the numbers of decision 6 as gates v2 read them', () => {
    expect(RELEASE_GATES).toMatchObject({
      version: 'review-analysis-gates-v2',
      urgentSafetyHealthMissesMax: 0,
      urgentRecallMin: 0.95,
      falseUrgentRateMax: 0.02,
      topicMicroF1Min: 0.85,
      topicF1Min: 0.7,
      topicF1MinSupport: 10,
      thingAgreementMin: 0.6,
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
      ...withTopic(slice, 'facilities_equipment', 0.7, 12),
      urgent: { ...slice.urgent, recall: 0.95, falseUrgentRate: 0.02 },
      topics: {
        ...withTopic(slice, 'facilities_equipment', 0.7, 12).topics,
        micro: { ...slice.topics.micro, f1: 0.85 },
      },
      mentions: {
        ...slice.mentions,
        causes: { ...slice.mentions.causes, thingAgreement: 0.6 },
      },
    }))
    const past = slicesOf((slice) => ({
      ...withTopic(slice, 'facilities_equipment', 0.699, 12),
      urgent: { ...slice.urgent, recall: 0.949, falseUrgentRate: 0.0201 },
      topics: {
        ...withTopic(slice, 'facilities_equipment', 0.699, 12).topics,
        micro: { ...slice.topics.micro, f1: 0.849 },
      },
      mentions: {
        ...slice.mentions,
        causes: { ...slice.mentions.causes, thingAgreement: 0.599 },
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
    const slices = only('all', (slice) => withTopic(slice, 'staff_service', 0.5, 14))

    const result = evaluateGates(slices).results.find(
      (one) => one.gate === 'topic_min_f1' && one.slice === 'all',
    )

    expect(result).toMatchObject({ status: 'fail', value: 0.5 })
    expect(result?.note).toBe('weakest topic staff_service (14 gold reviews)')
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

describe('the topic floor', () => {
  const minimum = RELEASE_GATES.topicF1MinSupport

  it('holds a topic that has exactly the minimum of gold reviews in the slice', () => {
    const slices = only('bg', (slice) => withTopic(slice, 'staff_service', 0.4, minimum))

    expect(statusOf(slices, 'topic_min_f1', 'bg')).toBe('fail')
    expect(statusOf(slices, 'topic_min_f1', 'all')).toBe('pass')
  })

  it('does not hold a topic with one review fewer, and says so in the note', () => {
    const slices = only('bg', (slice) =>
      withTopic(slice, 'booking_arrival', 0.4, minimum - 1),
    )

    const result = evaluateGates(slices).results.find(
      (one) => one.gate === 'topic_min_f1' && one.slice === 'bg',
    )

    expect(result).toMatchObject({ status: 'pass', value: 1 })
    expect(result?.note).toContain(`under ${minimum} gold reviews, not held:`)
    expect(result?.note).toContain(`booking_arrival ${minimum - 1}`)
  })

  it('is the case that failed the first OpenAI check: one gold review and one extra mention', () => {
    // Bulgarian booking_arrival: 1 gold review, found, with 1 extra mention in another review.
    const slices = only('bg', (slice) => withTopic(slice, 'booking_arrival', 2 / 3, 1))

    expect(statusOf(slices, 'topic_min_f1', 'bg')).toBe('pass')
    expect(evaluateGates(slices).verdict).toBe('pass')
  })

  it('reads the weakest of the held topics, not of all of them', () => {
    const slices = only('es', (slice) =>
      withTopic(
        withTopic(slice, 'booking_arrival', 0, 2),
        'staff_service',
        0.8,
        minimum + 5,
      ),
    )

    const result = evaluateGates(slices).results.find(
      (one) => one.gate === 'topic_min_f1' && one.slice === 'es',
    )

    expect(result).toMatchObject({ status: 'pass' })
    expect(result?.value).toBeCloseTo(0.8)
    expect(result?.note).toContain('weakest topic ')
  })

  it('cannot be read in a slice where no topic has the minimum, and that is not a pass', () => {
    const slices = only('bg', (slice) => {
      const sparse = withTopic(
        withTopic(slice, 'staff_service', 1, minimum - 1),
        'facilities_equipment',
        1,
        minimum - 1,
      )
      return sparse
    })

    const result = evaluateGates(slices).results.find(
      (one) => one.gate === 'topic_min_f1' && one.slice === 'bg',
    )

    expect(result).toMatchObject({ status: 'not_measurable', value: null })
    expect(result?.note).toContain(`no topic has ${minimum} gold reviews`)
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

  it('passes at 0.60 and fails below it, the level the two labelling families reach with each other', () => {
    const at = only('all', (slice) => ({
      ...slice,
      mentions: {
        ...slice.mentions,
        causes: { ...slice.mentions.causes, thingAgreement: 0.6 },
      },
    }))
    const below = only('all', (slice) => ({
      ...slice,
      mentions: {
        ...slice.mentions,
        causes: { ...slice.mentions.causes, thingAgreement: 0.599 },
      },
    }))

    expect(statusOf(at, 'thing_agreement', 'all')).toBe('pass')
    expect(statusOf(below, 'thing_agreement', 'all')).toBe('fail')
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
