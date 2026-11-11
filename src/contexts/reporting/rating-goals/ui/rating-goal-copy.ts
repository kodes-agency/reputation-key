// Approved wording is shared by setup and tracking. Changes require a new product
// decision.

/** Approved verbatim: under the plan, and in "Why every guest". */
export const PLAN_POLICY_LINE =
  'Your Portals offer every guest the same Google review link. Asking every guest, not only the ones who would write anyway, and better stays are what move this number.'

/** Approved verbatim: under the pace. "How to ask:" is set in bold. */
export const HOW_TO_ASK_LINE = {
  lead: 'How to ask:',
  text: 'ask every guest before they leave, and let them post on their own phone. A few each day works better than one big email to past guests. Never offer anything in return.',
} as const

/**
 * The way to ask, as a row on the goal's page: the approved words, split into
 * what to do and how.
 */
export const ASK_EVERY_GUEST_ROW = {
  title: 'Ask every guest before they leave',
  note: 'Let them post on their own phone. A few each day works better than one big email to past guests. Never offer anything in return.',
} as const

/** Why the planned average is above what the Property has now. */
export const UNASKED_REVIEWS_LINE =
  'Reviews that arrive unasked lean towards complaints. Asking everyone brings in the happy majority, so the average usually rises.'
