// Builders for the tests of the review-analysis v3 evaluation. Everything here is
// invented: a test never reads a real review and never needs a provider.

import type {
  ReviewAnalysisV3Stored,
  ReviewAnalysisV3StoredMention,
} from '#/shared/review-analysis-v3'
import type { CauseKey } from './review-analysis-v3-mention-metrics'
import type { ScoredRun } from './review-analysis-v3-metrics'
import type { ItemRunResult } from './review-analysis-v3-provider'
import type { EvaluationItem } from './review-analysis-v3-testset'

export function mention(
  overrides: Partial<ReviewAnalysisV3StoredMention> = {},
): ReviewAnalysisV3StoredMention {
  return {
    topic: 'facilities_equipment',
    polarity: 'negative',
    strength: 'clear',
    thing: 'air conditioning',
    issue: 'not working',
    sentences: [1],
    names_person: null,
    ...overrides,
  }
}

export function answer(
  mentions: readonly ReviewAnalysisV3StoredMention[] = [],
  overrides: Partial<ReviewAnalysisV3Stored> = {},
): ReviewAnalysisV3Stored {
  return { sentiment: 'negative', mentions, urgent: null, ...overrides }
}

export function item(overrides: Partial<EvaluationItem> = {}): EvaluationItem {
  return {
    id: 'cx-0001',
    business: 'Hotel',
    rating: 2,
    language: 'en',
    text: 'The air conditioning did not work.',
    sentences: ['The air conditioning did not work.'],
    tags: [],
    ...overrides,
  }
}

export function acceptedResult(
  itemId: string,
  stored: ReviewAnalysisV3Stored,
  overrides: Partial<ItemRunResult> = {},
): ItemRunResult {
  return {
    itemId,
    status: 'accepted',
    answer: stored,
    flags: [],
    droppedMentionCount: 0,
    latencyMillis: 10,
    usage: null,
    ...overrides,
  }
}

export function unusableResult(
  itemId: string,
  status: Exclude<ItemRunResult['status'], 'accepted'> = 'failed',
): ItemRunResult {
  return {
    itemId,
    status,
    answer: null,
    flags: [],
    droppedMentionCount: 0,
    latencyMillis: null,
    usage: null,
  }
}

export function scoredRun(
  id: string,
  reference: ReviewAnalysisV3Stored,
  result: ItemRunResult,
  itemOverrides: Partial<EvaluationItem> = {},
): ScoredRun {
  return { item: item({ id, ...itemOverrides }), reference, result }
}

const ALIASES: ReadonlyMap<string, string> = new Map([['ac', 'air conditioning']])

/** The simplest cause key: a thing is itself, an alias is its target, none is the topic. */
export const simpleCauseKey: CauseKey = (_topic, thing) =>
  thing === null ? '__topic__' : (ALIASES.get(thing) ?? thing)
