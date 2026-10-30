// The slices a review-analysis v3 evaluation is read in (contract section 8): the
// whole set and the three languages the release gates are read in, then, as
// context, the other languages, each business family, the length of the text and
// the cases the set was written to test (sarcasm, rating conflicts, near misses).
// Only the gating slices carry every score; the rest carry the headline numbers.

import type { CauseKey } from './review-analysis-v3-mention-metrics'
import { GATING_SLICES, type GatingSlice } from './review-analysis-v3-gates'
import {
  scoreSlice,
  type ScoredRun,
  type SliceMetrics,
} from './review-analysis-v3-metrics'
import type { Rate } from './review-analysis-v3-stats'

const LANGUAGE_SLICES: readonly string[] = ['en', 'bg', 'es']

export type SliceSummary = Readonly<{
  items: number
  sentimentAccuracy: Rate
  topicMicroF1: Rate
  thingAgreement: Rate
  urgentRecall: Rate
  falseUrgentRate: Rate
}>

export type SliceScores = Readonly<{
  gating: Readonly<Record<GatingSlice, SliceMetrics>>
  /** Everything else, by slice name, sorted. */
  context: Readonly<Record<string, SliceSummary>>
}>

function lengthBucket(textLength: number): string {
  if (textLength < 50) return 'length:under 50'
  if (textLength < 150) return 'length:50-149'
  if (textLength < 400) return 'length:150-399'
  return 'length:400+'
}

/** The slices one review belongs to, besides the whole set and its language. */
function contextSlicesOf(
  run: ScoredRun,
  familyOf: (business: string) => string,
): readonly string[] {
  return [
    ...(LANGUAGE_SLICES.includes(run.item.language) ? [] : ['language:other']),
    `family:${familyOf(run.item.business)}`,
    lengthBucket(run.item.text.length),
    ...run.item.tags.map((tag) => `tag:${tag}`),
  ]
}

function summarize(metrics: SliceMetrics): SliceSummary {
  return Object.freeze({
    items: metrics.items,
    sentimentAccuracy: metrics.sentiment.accuracy,
    topicMicroF1: metrics.topics.micro.f1,
    thingAgreement: metrics.mentions.causes.thingAgreement,
    urgentRecall: metrics.urgent.recall,
    falseUrgentRate: metrics.urgent.falseUrgentRate,
  })
}

function groupBy<Key>(
  runs: readonly ScoredRun[],
  keysOf: (run: ScoredRun) => readonly Key[],
): ReadonlyMap<Key, readonly ScoredRun[]> {
  const groups = new Map<Key, ScoredRun[]>()
  for (const run of runs) {
    for (const key of keysOf(run)) groups.set(key, [...(groups.get(key) ?? []), run])
  }
  return groups
}

/** Score the whole set, the gating languages and every context slice. */
export function scoreSlices(
  runs: readonly ScoredRun[],
  causeKey: CauseKey,
  familyOf: (business: string) => string,
): SliceScores {
  const byLanguage = groupBy(runs, (run) => [run.item.language])
  const gatingRuns: Record<GatingSlice, readonly ScoredRun[]> = {
    all: runs,
    en: byLanguage.get('en') ?? [],
    bg: byLanguage.get('bg') ?? [],
    es: byLanguage.get('es') ?? [],
  }
  const gating = Object.fromEntries(
    GATING_SLICES.map(
      (slice) => [slice, scoreSlice(gatingRuns[slice], causeKey)] as const,
    ),
  ) as Record<GatingSlice, SliceMetrics>
  const contextRuns = groupBy(runs, (run) => contextSlicesOf(run, familyOf))
  const context = Object.fromEntries(
    [...contextRuns.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, members]) => [name, summarize(scoreSlice(members, causeKey))] as const,
      ),
  )
  return Object.freeze({ gating: Object.freeze(gating), context: Object.freeze(context) })
}
