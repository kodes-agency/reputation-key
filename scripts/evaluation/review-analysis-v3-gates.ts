// The release gates of review analysis v3: decision 6 of v3-contract-decisions.md,
// which replaced the contract's proposed numbers, as measured once against a real
// provider (gates v2, 2026-10-30).
//
//   Urgent   zero misses on the gold set's safety and health cases, at least 95%
//            recall overall, and no more than 2% of the non-urgent gold reviews
//            flagged Urgent.
//   Topics   micro F1 at least 0.85 against the gold, and no topic below 0.70 in a
//            slice that holds at least 10 gold reviews of it.
//   Causes   thing agreement at least 0.60 after the same normalisation of the gold
//            and the answer. Of every mention either side made, the share that is a
//            pair agreeing on the thing: a cause only the gold has, or only the answer
//            has, counts against it.
//   Every gate is read per language (en, bg, es) and overall.
//
// Why v2 moved two numbers, and only those two. The first OpenAI measurement (400
// invented reviews, gpt-5.6-luna) met every other gate and read thing agreement at 0.51,
// and the weakest topic of Bulgarian and Spanish at 0.67 and 0.40.
//
// Thing agreement 0.70 -> 0.60. A provider cannot be held to more agreement with the gold
// than the gold's own labellers had with each other. By this very metric the first-round
// labels of the two labelling families (GPT through Codex, Claude) agree on the thing of a
// mention at 0.59 over the 400 reviews (1,089 paired mentions, 77 and 160 only in one of
// them), and at 0.66 once generic placeholders are null on both sides. The number is read
// after the same normalisation on both sides (property-issue-normalization-v1: plural rule
// and synonyms), so a plural or a synonym is not a disagreement; 0.60 asks a provider to
// agree with the gold about as well as one family agrees with the other.
//
// Weakest-topic floor 0.70, but only at 10 gold reviews. F1 of a topic with one or two
// gold reviews moves by 0.3 to 0.5 on a single miss or extra mention: Bulgarian
// booking_arrival has one gold review and read 0.67 on one extra, Spanish read 0.40 on
// three. That is noise from a count, not a finding about the provider. A topic below 10
// gold reviews in a slice is still scored, shown and named in the gate's note; it is not
// held to the floor. The micro F1 gate, which counts every topic, still reads those reviews.
//
// A gate over nothing is "not measurable", never a pass: and a slice with no topic of 10
// gold reviews reads the floor as not measurable too. A provider passes only when no
// measured gate fails and every gate over the whole set could be measured.

import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import type { SliceMetrics, TopicMetrics } from './review-analysis-v3-metrics'
import type { Rate } from './review-analysis-v3-stats'

export const RELEASE_GATES = Object.freeze({
  version: 'review-analysis-gates-v2',
  urgentSafetyHealthMissesMax: 0,
  urgentRecallMin: 0.95,
  falseUrgentRateMax: 0.02,
  topicMicroF1Min: 0.85,
  topicF1Min: 0.7,
  /** A topic is held to `topicF1Min` in a slice only when the gold has this many reviews of it there. */
  topicF1MinSupport: 10,
  thingAgreementMin: 0.6,
})

export const GATING_SLICES = Object.freeze(['all', 'en', 'bg', 'es'] as const)
export type GatingSlice = (typeof GATING_SLICES)[number]

export const GATE_IDS = Object.freeze([
  'urgent_safety_health_misses',
  'urgent_recall',
  'urgent_false_rate',
  'topic_micro_f1',
  'topic_min_f1',
  'thing_agreement',
] as const)
export type GateId = (typeof GATE_IDS)[number]

export type GateStatus = 'pass' | 'fail' | 'not_measurable'

export type GateResult = Readonly<{
  gate: GateId
  slice: GatingSlice
  status: GateStatus
  value: number | null
  threshold: number
  comparison: 'at_least' | 'at_most'
  /** Content-free: counts and topic ids, never a review. */
  note: string
}>

export type GateVerdict = 'pass' | 'fail' | 'incomplete'

export type GateReport = Readonly<{
  version: typeof RELEASE_GATES.version
  verdict: GateVerdict
  results: readonly GateResult[]
  failures: readonly GateResult[]
  unmeasured: readonly GateResult[]
}>

// A rate is one division, so a value exactly on its threshold (19 of 20 against
// 0.95) compares equal; the margin only absorbs a mean of such values.
const EPSILON = 1e-9

type Reading = Readonly<{ value: Rate; note: string }>

type GateDefinition = Readonly<{
  gate: GateId
  threshold: number
  comparison: 'at_least' | 'at_most'
  read: (metrics: SliceMetrics) => Reading
}>

/**
 * The topic floor: the weakest F1 among the topics the slice's gold holds at least
 * `topicF1MinSupport` reviews of. A topic with fewer is named in the note, never held to it.
 */
function readTopicFloor(topics: TopicMetrics): Reading {
  const minimum = RELEASE_GATES.topicF1MinSupport
  const supported = REVIEW_TOPICS_V3.flatMap((topic) => {
    const stat = topics.perTopic[topic]
    return stat.support > 0 && stat.f1 !== null
      ? [{ topic, f1: stat.f1, support: stat.support }]
      : []
  })
  const held = supported.filter((entry) => entry.support >= minimum)
  const weakest = held.reduce<(typeof held)[number] | null>(
    (worst, entry) => (worst === null || entry.f1 < worst.f1 ? entry : worst),
    null,
  )
  const exempt = supported
    .filter((entry) => entry.support < minimum)
    .map((entry) => `${entry.topic} ${entry.support}`)
  const exemptNote =
    exempt.length === 0
      ? ''
      : `; under ${minimum} gold reviews, not held: ${exempt.join(', ')}`
  return {
    value: weakest?.f1 ?? null,
    note:
      weakest === null
        ? `no topic has ${minimum} gold reviews${exemptNote}`
        : `weakest topic ${weakest.topic} (${weakest.support} gold reviews)${exemptNote}`,
  }
}

const DEFINITIONS: readonly GateDefinition[] = Object.freeze([
  {
    gate: 'urgent_safety_health_misses',
    threshold: RELEASE_GATES.urgentSafetyHealthMissesMax,
    comparison: 'at_most',
    read: ({ urgent }) => ({
      value: urgent.safetyHealthCases === 0 ? null : urgent.safetyHealthMisses,
      note: `${urgent.safetyHealthMisses} missed of ${urgent.safetyHealthCases} safety and health cases`,
    }),
  },
  {
    gate: 'urgent_recall',
    threshold: RELEASE_GATES.urgentRecallMin,
    comparison: 'at_least',
    read: ({ urgent }) => ({
      value: urgent.recall,
      note: `${urgent.detected} found of ${urgent.goldUrgent} urgent cases`,
    }),
  },
  {
    gate: 'urgent_false_rate',
    threshold: RELEASE_GATES.falseUrgentRateMax,
    comparison: 'at_most',
    read: ({ urgent }) => ({
      value: urgent.falseUrgentRate,
      note: `${urgent.falseUrgent} flagged of ${urgent.nonUrgentItems} non-urgent reviews`,
    }),
  },
  {
    gate: 'topic_micro_f1',
    threshold: RELEASE_GATES.topicMicroF1Min,
    comparison: 'at_least',
    read: ({ topics }) => ({
      value: topics.micro.f1,
      note: `${topics.micro.tp} right, ${topics.micro.fp} extra, ${topics.micro.fn} missed`,
    }),
  },
  {
    gate: 'topic_min_f1',
    threshold: RELEASE_GATES.topicF1Min,
    comparison: 'at_least',
    read: ({ topics }) => readTopicFloor(topics),
  },
  {
    gate: 'thing_agreement',
    threshold: RELEASE_GATES.thingAgreementMin,
    comparison: 'at_least',
    read: ({ mentions }) => ({
      value: mentions.causes.thingAgreement,
      note: `${mentions.causes.thingAgreeing} of ${
        mentions.pairs + mentions.unmatchedGold + mentions.unmatchedPredicted
      } mentions agree: ${mentions.pairs} paired, ${mentions.unmatchedGold} only in the gold, ${mentions.unmatchedPredicted} only in the answer`,
    }),
  },
])

function statusOf(definition: GateDefinition, value: Rate): GateStatus {
  if (value === null) return 'not_measurable'
  const met =
    definition.comparison === 'at_least'
      ? value + EPSILON >= definition.threshold
      : value - EPSILON <= definition.threshold
  return met ? 'pass' : 'fail'
}

/** Read every gate of decision 6 in every gating slice. */
export function evaluateGates(
  bySlice: Readonly<Record<GatingSlice, SliceMetrics>>,
): GateReport {
  const results = GATING_SLICES.flatMap((slice) =>
    DEFINITIONS.map((definition): GateResult => {
      const reading = definition.read(bySlice[slice])
      return Object.freeze({
        gate: definition.gate,
        slice,
        status: statusOf(definition, reading.value),
        value: reading.value,
        threshold: definition.threshold,
        comparison: definition.comparison,
        note: reading.note,
      })
    }),
  )
  const failures = results.filter((result) => result.status === 'fail')
  const unmeasured = results.filter((result) => result.status === 'not_measurable')
  const overallUnmeasured = unmeasured.some((result) => result.slice === 'all')
  const verdict: GateVerdict =
    failures.length > 0 ? 'fail' : overallUnmeasured ? 'incomplete' : 'pass'
  return Object.freeze({
    version: RELEASE_GATES.version,
    verdict,
    results: Object.freeze(results),
    failures: Object.freeze(failures),
    unmeasured: Object.freeze(unmeasured),
  })
}
