// Folds the attention counts and the rating comparison into the five
// attention-band reasons plus their distinct work total.

import type { AttentionSignals } from '../domain/dashboard-types'
import type { AttentionCounts } from './attention-signals.port.server'
import {
  ratingComparison,
  RATING_DROP_THRESHOLD,
} from '../portal-results/time-range.server'

export function attentionSignalsFrom(
  counts: AttentionCounts,
  rating: Readonly<{
    currentAverage: number | null
    currentCount: number
    priorAverage: number | null
    priorCount: number
  }>,
): AttentionSignals {
  const comparison = ratingComparison(
    rating.currentAverage,
    rating.currentCount,
    rating.priorAverage,
    rating.priorCount,
  )
  const ratingDrop = comparison !== null && comparison <= -RATING_DROP_THRESHOLD

  return {
    overdue: counts.overdue,
    itemsToTriage: counts.itemsToTriage,
    goalsBehindPace: counts.goalsBehindPace,
    ratingDrop,
    escalated: counts.escalated,
    needsAttention: counts.attentionWork + (ratingDrop ? 1 : 0),
  }
}
