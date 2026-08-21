// Pure text derivation for the content review card. Extracted so the
// precedence between "submission in flight" and "last recorded outcome" is
// stated once, in one readable place, rather than as a ternary chain nested
// inside the card's JSX.

import type { CompleteReviewResult } from '../shared/types'

const OUTCOME_MESSAGE: Record<CompleteReviewResult['status'], string> = {
  recorded: 'Content review recorded.',
  duplicate: 'That review was already recorded.',
}

/**
 * Text for the card's `role="status"` live region.
 *
 * An in-flight submission always wins over the previous outcome, so a repeat
 * submission announces progress instead of repeating a stale result. Returns
 * `''` when there is nothing to announce — the live region stays mounted (and
 * therefore able to announce later) while silent.
 */
export function reviewStatusMessage(
  isPending: boolean,
  outcome: CompleteReviewResult | null,
): string {
  if (isPending) return 'Recording content review'
  if (!outcome) return ''
  return OUTCOME_MESSAGE[outcome.status]
}
