// The Monthly portal goal's name and its approved sentences, each spelled here
// once and nowhere else (`portal-goal-sources.test.ts` pins them). The three
// lines are verbatim from the owner's decision P-8 (2026-10-17); change them
// only with a new decision. None of the Google rating goal's lines is used for
// a Portal goal: the two goals share no words (ADR 0068).

/** Copy deck G-3: what the goal is called on every screen. */
export const PORTAL_GOAL_NAME = 'Monthly portal goal'

/** Q-1 (P-8, approved verbatim): private ratings only, on the ready card and in the sheet. */
export const PORTAL_ASK_EVERY_GUEST_LINE =
  'Ask every guest, not only happy ones. Low and high ratings count the same.'

/** Q-2 (P-8, approved verbatim): after a Portal's code has gone 14 days without a scan. */
export const PORTAL_NO_SCAN_HINT = 'Is it where guests can see it?'

/** Q-3 (P-8, approved verbatim): before a goal for one Portal or a group, and on the average step. */
export const PORTAL_SPOT_NOT_PERSON_LINE =
  'Portal goals are about the spot, not the person who works there.'
