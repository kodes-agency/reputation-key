// Pure text for the link check card. Extracted so the precedence between
// "submission in flight" and "last recorded outcome" is stated once, in one
// readable place, rather than as a ternary chain nested inside the card's JSX.

import type { CompleteReviewResult } from '../shared/types'

const OUTCOME_MESSAGE: Record<CompleteReviewResult['status'], string> = {
  recorded: 'Link check recorded.',
  duplicate: 'That check was already recorded.',
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
  if (isPending) return 'Recording the link check'
  if (!outcome) return ''
  return OUTCOME_MESSAGE[outcome.status]
}

/** The page the check covers, by name: "live version 5", or "the live page" when no version is known. */
export function liveVersionName(liveVersion: number | null): string {
  return liveVersion === null ? 'the live page' : `live version ${liveVersion}`
}
