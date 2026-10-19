// What every Google rating goal card says in its header: its title and the id of
// that title. The card draws them through the shared goal card frame
// (`goal-card-frame.tsx`). The wizard and the Monday recap hand the focus back to
// this title, wherever the section draws it (the Goals page and the Property
// Overview).

/**
 * The id of the section's heading, wherever the section draws it: the wizard
 * hands the focus back to it when the button that opened it is gone (the empty
 * state's "Set goal" turns into the card once the goal is set).
 */
export const RATING_GOAL_HEADING_ID = 'google-rating-goal-title'

/** The card's title, "Google rating goal". */
export const RATING_GOAL_TITLE = 'Google rating goal'
