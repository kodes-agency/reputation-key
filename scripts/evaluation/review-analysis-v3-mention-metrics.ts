// The mention-level scores of the review-analysis v3 evaluation (contract section 8):
// polarity, strength, cause, evidence sentences and the names flag. They are scored
// AFTER topic matching: a mention of the gold is paired with the answer's mention
// of the same topic that resembles it most, and the pairs are what get compared.
// Whether the topic was found at all is the topic score's business, not theirs.

import type { ReviewAnalysisV3StoredMention } from '#/shared/review-analysis-v3'
import { REVIEW_STRENGTH_RANK_V3 } from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import { meanOf, prf, ratio, type Prf, type Rate } from './review-analysis-v3-stats'

/**
 * The key two `thing` values are compared by. The command passes the governed
 * property-issue normalisation (`property-issue-normalization-v1`), so "ac" and
 * "air conditioning" agree in the facilities topic; a test may pass a simpler one.
 */
export type CauseKey = (topic: ReviewTopicV3, thing: string | null) => string

type Mention = ReviewAnalysisV3StoredMention

/** The gold and the answer's mentions of one review. */
export type MentionSides = Readonly<{
  itemId: string
  gold: readonly Mention[]
  predicted: readonly Mention[]
}>

export type MentionPair = Readonly<{ gold: Mention; predicted: Mention }>

export type MentionAlignment = Readonly<{
  pairs: readonly MentionPair[]
  unmatchedGold: number
  unmatchedPredicted: number
}>

const THING_WEIGHT = 4
const POLARITY_WEIGHT = 2
const SENTENCE_WEIGHT = 1

function overlaps(left: readonly number[], right: readonly number[]): boolean {
  return left.some((number) => right.includes(number))
}

function pairWeight(gold: Mention, predicted: Mention, causeKey: CauseKey): number {
  return (
    (causeKey(gold.topic, gold.thing) === causeKey(predicted.topic, predicted.thing)
      ? THING_WEIGHT
      : 0) +
    (gold.polarity === predicted.polarity ? POLARITY_WEIGHT : 0) +
    (overlaps(gold.sentences, predicted.sentences) ? SENTENCE_WEIGHT : 0)
  )
}

/**
 * Pair the mentions of one review one-to-one, within a topic. The best pairs
 * (same thing, same polarity, overlapping sentences) are taken first and ties go
 * to the earlier mention, so the pairing is deterministic and explainable. A
 * mention with no partner of its topic stays unmatched.
 */
export function alignMentions(
  gold: readonly Mention[],
  predicted: readonly Mention[],
  causeKey: CauseKey,
): MentionAlignment {
  const candidates: { goldIndex: number; predictedIndex: number; weight: number }[] = []
  gold.forEach((goldMention, goldIndex) => {
    predicted.forEach((predictedMention, predictedIndex) => {
      if (goldMention.topic !== predictedMention.topic) return
      candidates.push({
        goldIndex,
        predictedIndex,
        weight: pairWeight(goldMention, predictedMention, causeKey),
      })
    })
  })
  candidates.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.goldIndex - b.goldIndex ||
      a.predictedIndex - b.predictedIndex,
  )
  const usedGold = new Set<number>()
  const usedPredicted = new Set<number>()
  const pairs: MentionPair[] = []
  for (const candidate of candidates) {
    if (
      usedGold.has(candidate.goldIndex) ||
      usedPredicted.has(candidate.predictedIndex)
    ) {
      continue
    }
    const goldMention = gold[candidate.goldIndex]
    const predictedMention = predicted[candidate.predictedIndex]
    if (goldMention === undefined || predictedMention === undefined) continue
    usedGold.add(candidate.goldIndex)
    usedPredicted.add(candidate.predictedIndex)
    pairs.push(Object.freeze({ gold: goldMention, predicted: predictedMention }))
  }
  return Object.freeze({
    pairs: Object.freeze(pairs),
    unmatchedGold: gold.length - pairs.length,
    unmatchedPredicted: predicted.length - pairs.length,
  })
}

function tokensOf(phrase: string): readonly string[] {
  return phrase.split(/[\s-]+/u).filter((token) => token !== '')
}

/** Token F1 of two phrases; two absent phrases agree, one absent phrase does not. */
export function phraseTokenF1(left: string | null, right: string | null): number {
  if (left === null || right === null) return left === right ? 1 : 0
  const leftTokens = tokensOf(left)
  const rightTokens = tokensOf(right)
  const remaining = [...rightTokens]
  let shared = 0
  for (const token of leftTokens) {
    const at = remaining.indexOf(token)
    if (at < 0) continue
    remaining.splice(at, 1)
    shared += 1
  }
  const total = leftTokens.length + rightTokens.length
  return total === 0 ? 1 : (2 * shared) / total
}

export type CauseMetrics = Readonly<{
  /**
   * The release gate (decision 6): the share of all the mentions of either side that are
   * a pair agreeing on the normalised `thing`. A mention only one side has (a second
   * cause under a topic the answer mentioned once, or one the gold lacks) counts
   * against it, so an answer cannot reach 1 by returning only the causes it is sure of.
   * Null when neither side has a mention.
   */
  thingAgreement: Rate
  /** The mentions behind `thingAgreement`: pairs whose normalised `thing` agrees. */
  thingAgreeing: number
  /** F1 over the (topic, polarity, thing) triples of a review, found or not. */
  thingF1: Rate
  issueExact: Rate
  issueTokenF1: Rate
  /** The same thing, the same issue and the same polarity. */
  fullAgreement: Rate
}>

export type NamesMetrics = Readonly<{
  teamMember: Prf
  other: Prf
  /** The gold names a person and the answer names none: a quote could leak a name. */
  privacyCriticalMisses: number
  /** The answer names a person the gold does not: a quote skipped for nothing. */
  needlessSuppressions: number
}>

export type MentionMetrics = Readonly<{
  pairs: number
  unmatchedGold: number
  unmatchedPredicted: number
  polarityAccuracy: Rate
  strengthAccuracy: Rate
  strengthWithinOne: Rate
  causes: CauseMetrics
  /** Sentence numbers of the paired mentions. */
  evidence: Prf
  names: NamesMetrics
}>

function triples(mentions: readonly Mention[], causeKey: CauseKey): ReadonlySet<string> {
  return new Set(
    mentions.map((mention) =>
      JSON.stringify([
        mention.topic,
        mention.polarity,
        causeKey(mention.topic, mention.thing),
      ]),
    ),
  )
}

function thingF1Counts(
  sides: readonly MentionSides[],
  causeKey: CauseKey,
): Readonly<{ tp: number; fp: number; fn: number }> {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const side of sides) {
    const gold = triples(side.gold, causeKey)
    const predicted = triples(side.predicted, causeKey)
    for (const key of predicted) {
      if (gold.has(key)) tp += 1
      else fp += 1
    }
    for (const key of gold) if (!predicted.has(key)) fn += 1
  }
  return { tp, fp, fn }
}

function evidenceCounts(
  pairs: readonly MentionPair[],
): Readonly<{ tp: number; fp: number; fn: number }> {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const { gold, predicted } of pairs) {
    for (const number of predicted.sentences) {
      if (gold.sentences.includes(number)) tp += 1
      else fp += 1
    }
    for (const number of gold.sentences)
      if (!predicted.sentences.includes(number)) fn += 1
  }
  return { tp, fp, fn }
}

function namesMetrics(pairs: readonly MentionPair[]): NamesMetrics {
  const counts = (name: 'team_member' | 'other') => {
    let tp = 0
    let fp = 0
    let fn = 0
    for (const { gold, predicted } of pairs) {
      const expected = gold.names_person === name
      const said = predicted.names_person === name
      if (expected && said) tp += 1
      else if (said) fp += 1
      else if (expected) fn += 1
    }
    return prf(tp, fp, fn)
  }
  return Object.freeze({
    teamMember: counts('team_member'),
    other: counts('other'),
    privacyCriticalMisses: pairs.filter(
      ({ gold, predicted }) =>
        gold.names_person !== null && predicted.names_person === null,
    ).length,
    needlessSuppressions: pairs.filter(
      ({ gold, predicted }) =>
        gold.names_person === null && predicted.names_person !== null,
    ).length,
  })
}

function causeMetrics(
  pairs: readonly MentionPair[],
  unpaired: number,
  sides: readonly MentionSides[],
  causeKey: CauseKey,
): CauseMetrics {
  const agrees = (pair: MentionPair) =>
    causeKey(pair.gold.topic, pair.gold.thing) ===
    causeKey(pair.predicted.topic, pair.predicted.thing)
  const sameIssue = (pair: MentionPair) => pair.gold.issue === pair.predicted.issue
  const thingCounts = thingF1Counts(sides, causeKey)
  const thingAgreeing = pairs.filter(agrees).length
  return Object.freeze({
    thingAgreement: ratio(thingAgreeing, pairs.length + unpaired),
    thingAgreeing,
    thingF1: prf(thingCounts.tp, thingCounts.fp, thingCounts.fn).f1,
    issueExact: ratio(pairs.filter(sameIssue).length, pairs.length),
    issueTokenF1: meanOf(
      pairs.map((pair) => phraseTokenF1(pair.gold.issue, pair.predicted.issue)),
    ),
    fullAgreement: ratio(
      pairs.filter(
        (pair) =>
          agrees(pair) &&
          sameIssue(pair) &&
          pair.gold.polarity === pair.predicted.polarity,
      ).length,
      pairs.length,
    ),
  })
}

/** Score every review's mentions; `sides` hold the gold and the answer of each. */
export function scoreMentions(
  sides: readonly MentionSides[],
  causeKey: CauseKey,
): MentionMetrics {
  const alignments = sides.map((side) =>
    alignMentions(side.gold, side.predicted, causeKey),
  )
  const pairs = alignments.flatMap((alignment) => alignment.pairs)
  const strengthDistance = (pair: MentionPair) =>
    Math.abs(
      REVIEW_STRENGTH_RANK_V3[pair.gold.strength] -
        REVIEW_STRENGTH_RANK_V3[pair.predicted.strength],
    )
  const evidence = evidenceCounts(pairs)
  const unmatchedGold = alignments.reduce((total, one) => total + one.unmatchedGold, 0)
  const unmatchedPredicted = alignments.reduce(
    (total, one) => total + one.unmatchedPredicted,
    0,
  )
  return Object.freeze({
    pairs: pairs.length,
    unmatchedGold,
    unmatchedPredicted,
    polarityAccuracy: ratio(
      pairs.filter((pair) => pair.gold.polarity === pair.predicted.polarity).length,
      pairs.length,
    ),
    strengthAccuracy: ratio(
      pairs.filter((pair) => strengthDistance(pair) === 0).length,
      pairs.length,
    ),
    strengthWithinOne: ratio(
      pairs.filter((pair) => strengthDistance(pair) <= 1).length,
      pairs.length,
    ),
    causes: causeMetrics(pairs, unmatchedGold + unmatchedPredicted, sides, causeKey),
    evidence: prf(evidence.tp, evidence.fp, evidence.fn),
    names: namesMetrics(pairs),
  })
}
