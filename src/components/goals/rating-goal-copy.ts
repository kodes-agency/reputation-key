// The Google rating goal's approved sentences, in one place for setup and
// tracking. Each is verbatim from the owner's decision named beside it; change
// them only with a new decision.

/** R2-12, approved verbatim: under the plan, and in "Why every guest". */
export const PLAN_POLICY_LINE =
  'Your Portals offer every guest the same Google review link. Asking every guest, not only the ones who would write anyway, and better stays are what move this number.'

/** R3-12, approved verbatim: under the pace. "How to ask:" is set in bold. */
export const HOW_TO_ASK_LINE = {
  lead: 'How to ask:',
  text: 'ask every guest before they leave, and let them post on their own phone. A few each day works better than one big email to past guests. Never offer anything in return.',
} as const

/**
 * The way to ask, as a row on the goal's page: R3-12's approved words, split into
 * what to do and how (2026-11-01).
 */
export const ASK_EVERY_GUEST_ROW = {
  title: 'Ask every guest before they leave',
  note: 'Let them post on their own phone. A few each day works better than one big email to past guests. Never offer anything in return.',
} as const

/** R3-9: why the planned average is above what the Property has now. */
export const UNASKED_REVIEWS_LINE =
  'Reviews that arrive unasked lean towards complaints. Asking everyone brings in the happy majority, so the average usually rises.'
