// Scoring of one slice of a review-analysis v3 evaluation run (contract section 8):
// sentiment, topics, mentions, Urgent and robustness. Pure functions over the
// reviews of a slice, their gold reference and what the provider's answers became
// after the production normalizer.
//
// An answer that is not usable (invalid, refused, truncated, failed, never sent)
// is scored as an empty answer: no sentiment, no mention, not urgent. That is the
// strict reading, and the only honest one for Urgent: a review the provider failed
// on is a review whose danger nobody saw.

import {
  REVIEW_SENTIMENTS_V3,
  type ReviewAnalysisV3Stored,
  type ReviewSentimentV3,
  type ReviewUrgentReasonV3,
} from '#/shared/review-analysis-v3'
import { REVIEW_TOPICS_V3, type ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { ItemRunResult, ItemRunStatus } from './review-analysis-v3-provider'
import {
  scoreMentions,
  type CauseKey,
  type MentionMetrics,
} from './review-analysis-v3-mention-metrics'
import {
  meanOf,
  prf,
  ratio,
  tally,
  type Prf,
  type Rate,
} from './review-analysis-v3-stats'
import type { EvaluationItem } from './review-analysis-v3-testset'

/** A review, the gold as the production normalizer accepts it, and the provider's result. */
export type ScoredRun = Readonly<{
  item: EvaluationItem
  reference: ReviewAnalysisV3Stored
  result: ItemRunResult
}>

export type SentimentMetrics = Readonly<{
  accuracy: Rate
  macroF1: Rate
  perClass: Readonly<Record<ReviewSentimentV3, Prf>>
}>

export type TopicStat = Prf &
  Readonly<{
    /** Reviews whose gold holds this topic. */
    support: number
  }>

export type TopicMetrics = Readonly<{
  micro: Prf
  macroF1: Rate
  perTopic: Readonly<Record<ReviewTopicV3, TopicStat>>
  /** The weakest topic that has gold support: the "no topic below 0.70" gate reads it. */
  weakest: Readonly<{ topic: ReviewTopicV3; f1: number }> | null
  /** Topics the answers named where the gold has none; they lower micro F1 only. */
  unsupportedTopicsPredicted: readonly ReviewTopicV3[]
}>

type ReasonOrNone = ReviewUrgentReasonV3 | 'none'

export type UrgentMetrics = Readonly<{
  goldUrgent: number
  predictedUrgent: number
  detected: number
  recall: Rate
  precision: Rate
  safetyHealthCases: number
  safetyHealthMisses: number
  /** Reviews the gold does not call urgent. */
  nonUrgentItems: number
  falseUrgent: number
  falseUrgentRate: Rate
  nearMissItems: number
  nearMissFalseUrgent: number
  nearMissSpecificity: Rate
  /** Gold reason (or none) by the answer's reason (or none). */
  confusion: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Of the urgent reviews found, the share given the right reason. */
  reasonAccuracyWhenDetected: Rate
}>

export type RobustnessMetrics = Readonly<{
  items: number
  byStatus: Readonly<Partial<Record<ItemRunStatus, number>>>
  /** Accepted answers over all reviews: the "usable answer" rate of the contract. */
  usableRate: Rate
  droppedMentions: number
  flagCounts: Readonly<Partial<Record<string, number>>>
  capEvents: number
  meanLatencyMillis: Rate
  maxLatencyMillis: number | null
  inputTokens: number
  outputTokens: number
}>

export type SliceMetrics = Readonly<{
  items: number
  sentiment: SentimentMetrics
  topics: TopicMetrics
  mentions: MentionMetrics
  urgent: UrgentMetrics
  robustness: RobustnessMetrics
}>

const SAFETY_HEALTH: readonly ReviewUrgentReasonV3[] = ['safety', 'health']
const NEAR_MISS_TAG = 'urgent_nearmiss'
const CAP_FLAGS: readonly string[] = ['mentions_capped', 'sentence_refs_capped']

function predictedOf(run: ScoredRun): ReviewAnalysisV3Stored | null {
  return run.result.status === 'accepted' ? run.result.answer : null
}

function sentimentMetrics(runs: readonly ScoredRun[]): SentimentMetrics {
  let correct = 0
  const counts = new Map<ReviewSentimentV3, { tp: number; fp: number; fn: number }>(
    REVIEW_SENTIMENTS_V3.map((sentiment) => [sentiment, { tp: 0, fp: 0, fn: 0 }]),
  )
  for (const run of runs) {
    const expected = run.reference.sentiment
    const said = predictedOf(run)?.sentiment ?? null
    if (expected === said) correct += 1
    const expectedCounts = counts.get(expected)
    const saidCounts = said === null ? undefined : counts.get(said)
    if (expected === said && expectedCounts !== undefined) expectedCounts.tp += 1
    else {
      if (expectedCounts !== undefined) expectedCounts.fn += 1
      if (saidCounts !== undefined) saidCounts.fp += 1
    }
  }
  const perClass = Object.fromEntries(
    REVIEW_SENTIMENTS_V3.map((sentiment) => {
      const one = counts.get(sentiment) ?? { tp: 0, fp: 0, fn: 0 }
      return [sentiment, prf(one.tp, one.fp, one.fn)] as const
    }),
  ) as Record<ReviewSentimentV3, Prf>
  return Object.freeze({
    accuracy: ratio(correct, runs.length),
    macroF1: meanOf(Object.values(perClass).map((one) => one.f1)),
    perClass: Object.freeze(perClass),
  })
}

function topicSet(answer: ReviewAnalysisV3Stored | null): ReadonlySet<ReviewTopicV3> {
  return new Set(answer?.mentions.map((mention) => mention.topic) ?? [])
}

function topicMetrics(runs: readonly ScoredRun[]): TopicMetrics {
  const counts = new Map<
    ReviewTopicV3,
    { tp: number; fp: number; fn: number; support: number }
  >(REVIEW_TOPICS_V3.map((topic) => [topic, { tp: 0, fp: 0, fn: 0, support: 0 }]))
  for (const run of runs) {
    const expected = topicSet(run.reference)
    const said = topicSet(predictedOf(run))
    for (const [topic, one] of counts) {
      if (expected.has(topic)) one.support += 1
      if (expected.has(topic) && said.has(topic)) one.tp += 1
      else if (said.has(topic)) one.fp += 1
      else if (expected.has(topic)) one.fn += 1
    }
  }
  const stats = REVIEW_TOPICS_V3.map((topic) => {
    const one = counts.get(topic) ?? { tp: 0, fp: 0, fn: 0, support: 0 }
    return [
      topic,
      Object.freeze({ ...prf(one.tp, one.fp, one.fn), support: one.support }),
    ] as const
  })
  const perTopic = Object.fromEntries(stats) as Record<ReviewTopicV3, TopicStat>
  const total = [...counts.values()].reduce(
    (sum, one) => ({ tp: sum.tp + one.tp, fp: sum.fp + one.fp, fn: sum.fn + one.fn }),
    { tp: 0, fp: 0, fn: 0 },
  )
  const supported = stats.filter(([, stat]) => stat.support > 0 && stat.f1 !== null)
  const weakest = supported.reduce<TopicMetrics['weakest']>((worst, [topic, stat]) => {
    const f1 = stat.f1 ?? 0
    return worst === null || f1 < worst.f1 ? { topic, f1 } : worst
  }, null)
  return Object.freeze({
    micro: prf(total.tp, total.fp, total.fn),
    macroF1: meanOf(
      stats.filter(([, stat]) => stat.f1 !== null).map(([, stat]) => stat.f1),
    ),
    perTopic: Object.freeze(perTopic),
    weakest,
    unsupportedTopicsPredicted: Object.freeze(
      stats
        .filter(([, stat]) => stat.support === 0 && stat.fp > 0)
        .map(([topic]) => topic),
    ),
  })
}

function reasonOf(answer: ReviewAnalysisV3Stored | null): ReasonOrNone {
  return answer?.urgent?.reason ?? 'none'
}

function confusionOf(
  runs: readonly ScoredRun[],
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const rows = new Map<string, ReasonOrNone[]>()
  for (const run of runs) {
    const gold = reasonOf(run.reference)
    rows.set(gold, [...(rows.get(gold) ?? []), reasonOf(predictedOf(run))])
  }
  return Object.freeze(
    Object.fromEntries(
      [...rows.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([gold, said]) => [gold, tally(said)] as const),
    ),
  )
}

function urgentMetrics(runs: readonly ScoredRun[]): UrgentMetrics {
  const urgentGold = runs.filter((run) => run.reference.urgent !== null)
  const nonUrgent = runs.filter((run) => run.reference.urgent === null)
  const saidUrgent = (run: ScoredRun) => reasonOf(predictedOf(run)) !== 'none'
  const detected = urgentGold.filter(saidUrgent)
  const safetyHealth = urgentGold.filter((run) => {
    const reason = run.reference.urgent?.reason
    return reason !== undefined && SAFETY_HEALTH.includes(reason)
  })
  const falseUrgent = nonUrgent.filter(saidUrgent)
  const nearMiss = nonUrgent.filter((run) => run.item.tags.includes(NEAR_MISS_TAG))
  const nearMissFalse = nearMiss.filter(saidUrgent)
  const rightReason = detected.filter(
    (run) => reasonOf(predictedOf(run)) === reasonOf(run.reference),
  )
  return Object.freeze({
    goldUrgent: urgentGold.length,
    predictedUrgent: runs.filter(saidUrgent).length,
    detected: detected.length,
    recall: ratio(detected.length, urgentGold.length),
    precision: ratio(detected.length, runs.filter(saidUrgent).length),
    safetyHealthCases: safetyHealth.length,
    safetyHealthMisses: safetyHealth.filter((run) => !saidUrgent(run)).length,
    nonUrgentItems: nonUrgent.length,
    falseUrgent: falseUrgent.length,
    falseUrgentRate: ratio(falseUrgent.length, nonUrgent.length),
    nearMissItems: nearMiss.length,
    nearMissFalseUrgent: nearMissFalse.length,
    nearMissSpecificity: ratio(nearMiss.length - nearMissFalse.length, nearMiss.length),
    confusion: confusionOf(runs),
    reasonAccuracyWhenDetected: ratio(rightReason.length, detected.length),
  })
}

function robustnessMetrics(runs: readonly ScoredRun[]): RobustnessMetrics {
  const results = runs.map((run) => run.result)
  const latencies = results
    .map((result) => result.latencyMillis)
    .filter((value): value is number => value !== null)
  const flags = results.flatMap((result) => result.flags)
  return Object.freeze({
    items: runs.length,
    byStatus: tally(results.map((result) => result.status)),
    usableRate: ratio(
      results.filter((result) => result.status === 'accepted').length,
      runs.length,
    ),
    droppedMentions: results.reduce(
      (total, result) => total + result.droppedMentionCount,
      0,
    ),
    flagCounts: tally(flags),
    capEvents: flags.filter((flag) => CAP_FLAGS.includes(flag)).length,
    meanLatencyMillis: meanOf(latencies),
    maxLatencyMillis: latencies.length === 0 ? null : Math.max(...latencies),
    inputTokens: results.reduce(
      (total, result) => total + (result.usage?.inputTokens ?? 0),
      0,
    ),
    outputTokens: results.reduce(
      (total, result) => total + (result.usage?.outputTokens ?? 0),
      0,
    ),
  })
}

/** Every score of one slice. */
export function scoreSlice(runs: readonly ScoredRun[], causeKey: CauseKey): SliceMetrics {
  return Object.freeze({
    items: runs.length,
    sentiment: sentimentMetrics(runs),
    topics: topicMetrics(runs),
    mentions: scoreMentions(
      runs.map((run) => ({
        itemId: run.item.id,
        gold: run.reference.mentions,
        predicted: predictedOf(run)?.mentions ?? [],
      })),
      causeKey,
    ),
    urgent: urgentMetrics(runs),
    robustness: robustnessMetrics(runs),
  })
}

export type RunInstability = Readonly<{
  items: number
  /** Reviews whose final label differs between the two runs. */
  differentLabels: number
  differentTopicSets: number
  differentUrgent: number
  differentStatus: number
  labelDisagreementRate: Rate
}>

/** How far two runs of the same provider on the same reviews disagree. */
export function compareRuns(
  first: readonly ItemRunResult[],
  second: readonly ItemRunResult[],
): RunInstability {
  const secondById = new Map(second.map((result) => [result.itemId, result] as const))
  let differentLabels = 0
  let differentTopicSets = 0
  let differentUrgent = 0
  let differentStatus = 0
  let items = 0
  for (const left of first) {
    const right = secondById.get(left.itemId)
    if (right === undefined) continue
    items += 1
    if (left.status !== right.status) differentStatus += 1
    if (JSON.stringify(left.answer) !== JSON.stringify(right.answer)) differentLabels += 1
    const leftTopics = [...topicSet(left.answer)].sort().join(',')
    const rightTopics = [...topicSet(right.answer)].sort().join(',')
    if (leftTopics !== rightTopics) differentTopicSets += 1
    if (reasonOf(left.answer) !== reasonOf(right.answer)) differentUrgent += 1
  }
  return Object.freeze({
    items,
    differentLabels,
    differentTopicSets,
    differentUrgent,
    differentStatus,
    labelDisagreementRate: ratio(differentLabels, items),
  })
}
