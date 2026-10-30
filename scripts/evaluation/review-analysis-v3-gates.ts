// The release gates of review analysis v3: decision 6 of v3-contract-decisions.md,
// which replaced the contract's proposed numbers.
//
//   Urgent   zero misses on the gold set's safety and health cases, at least 95%
//            recall overall, and no more than 2% of the non-urgent gold reviews
//            flagged Urgent.
//   Topics   micro F1 at least 0.85 against the gold, and no topic below 0.70.
//   Causes   thing agreement at least 0.70 after normalisation. Of every mention either
//            side made, the share that is a pair agreeing on the thing: a cause only the
//            gold has, or only the answer has, counts against it.
//   Every gate is read per language (en, bg, es) and overall.
//
// A gate over nothing is "not measurable", never a pass: the synthetic set holds
// no urgent case outside English, and saying so is the point of the harness. A
// provider passes only when no measured gate fails and every gate over the whole
// set could be measured.

import type { SliceMetrics } from './review-analysis-v3-metrics'
import type { Rate } from './review-analysis-v3-stats'

export const RELEASE_GATES_V1 = Object.freeze({
  version: 'review-analysis-gates-v1',
  urgentSafetyHealthMissesMax: 0,
  urgentRecallMin: 0.95,
  falseUrgentRateMax: 0.02,
  topicMicroF1Min: 0.85,
  topicF1Min: 0.7,
  thingAgreementMin: 0.7,
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
  version: typeof RELEASE_GATES_V1.version
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

const DEFINITIONS: readonly GateDefinition[] = Object.freeze([
  {
    gate: 'urgent_safety_health_misses',
    threshold: RELEASE_GATES_V1.urgentSafetyHealthMissesMax,
    comparison: 'at_most',
    read: ({ urgent }) => ({
      value: urgent.safetyHealthCases === 0 ? null : urgent.safetyHealthMisses,
      note: `${urgent.safetyHealthMisses} missed of ${urgent.safetyHealthCases} safety and health cases`,
    }),
  },
  {
    gate: 'urgent_recall',
    threshold: RELEASE_GATES_V1.urgentRecallMin,
    comparison: 'at_least',
    read: ({ urgent }) => ({
      value: urgent.recall,
      note: `${urgent.detected} found of ${urgent.goldUrgent} urgent cases`,
    }),
  },
  {
    gate: 'urgent_false_rate',
    threshold: RELEASE_GATES_V1.falseUrgentRateMax,
    comparison: 'at_most',
    read: ({ urgent }) => ({
      value: urgent.falseUrgentRate,
      note: `${urgent.falseUrgent} flagged of ${urgent.nonUrgentItems} non-urgent reviews`,
    }),
  },
  {
    gate: 'topic_micro_f1',
    threshold: RELEASE_GATES_V1.topicMicroF1Min,
    comparison: 'at_least',
    read: ({ topics }) => ({
      value: topics.micro.f1,
      note: `${topics.micro.tp} right, ${topics.micro.fp} extra, ${topics.micro.fn} missed`,
    }),
  },
  {
    gate: 'topic_min_f1',
    threshold: RELEASE_GATES_V1.topicF1Min,
    comparison: 'at_least',
    read: ({ topics }) => ({
      value: topics.weakest?.f1 ?? null,
      note:
        topics.weakest === null
          ? 'no topic has gold support'
          : `weakest topic ${topics.weakest.topic}`,
    }),
  },
  {
    gate: 'thing_agreement',
    threshold: RELEASE_GATES_V1.thingAgreementMin,
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
    version: RELEASE_GATES_V1.version,
    verdict,
    results: Object.freeze(results),
    failures: Object.freeze(failures),
    unmeasured: Object.freeze(unmeasured),
  })
}
