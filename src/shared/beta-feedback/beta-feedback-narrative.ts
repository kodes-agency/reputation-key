// How a guided report becomes the one free-text field the contract accepts.
//
// The wire contract stays a single `message`, so the guided prompts are purely
// a reporting aid: three short answers that a triager can actually act on,
// folded into one body here rather than becoming three provider fields.

import type { BetaFeedbackImpact, BetaFeedbackType } from './beta-feedback-contract'

export type BetaFeedbackNarrative = Readonly<{
  /** What the reporter was trying to do. Bug reports only. */
  context: string
  /** What actually happened — the only part a Suggestion uses. */
  observed: string
  /** What they expected instead. Bug reports only. */
  expected: string
}>

export const EMPTY_NARRATIVE: BetaFeedbackNarrative = Object.freeze({
  context: '',
  observed: '',
  expected: '',
})

const BUG_SECTIONS: ReadonlyArray<readonly [keyof BetaFeedbackNarrative, string]> = [
  ['context', 'What I was doing'],
  ['observed', 'What happened'],
  ['expected', 'What I expected'],
]

/**
 * Fold the guided answers into one body. Blank sections are dropped rather than
 * emitted as empty headings, so a reporter who fills in only the middle box
 * still sends something clean.
 */
export function composeBetaFeedbackMessage(
  kind: BetaFeedbackType,
  narrative: BetaFeedbackNarrative,
): string {
  if (kind !== 'bug') return narrative.observed.trim()

  return BUG_SECTIONS.map(([key, heading]) => {
    const value = narrative[key].trim()
    return value ? `${heading}:\n${value}` : ''
  })
    .filter(Boolean)
    .join('\n\n')
}

/** Human wording for the closed impact vocabulary, per report type. */
export const IMPACT_LABELS: Readonly<Record<BetaFeedbackImpact, string>> = Object.freeze({
  cannot_complete: 'I could not finish what I was doing',
  workaround_available: 'I found a way around it',
  small_issue: 'Minor — it did not block me',
  important: 'Important — this would change how I work',
  helpful: 'Helpful — it would save me time',
  nice_to_have: 'Nice to have',
})

/** Impact defaults that keep a half-finished form valid for its current type. */
export const DEFAULT_IMPACT: Readonly<Record<BetaFeedbackType, BetaFeedbackImpact>> =
  Object.freeze({ bug: 'workaround_available', suggestion: 'helpful' })
