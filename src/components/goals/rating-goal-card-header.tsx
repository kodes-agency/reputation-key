// The header every Google rating goal card shares: its title and one chip. The
// wizard and the Monday recap hand the focus back to this title, wherever the
// section draws it (the Goals page and the Property Overview).
import type { ReactNode } from 'react'
import { CardHeader, CardTitle } from '#/components/ui/card'

/**
 * The id of the section's heading, wherever the section draws it: the wizard
 * hands the focus back to it when the button that opened it is gone (the empty
 * state's "Set goal" turns into the card once the goal is set).
 */
export const RATING_GOAL_HEADING_ID = 'google-rating-goal-title'

/**
 * "Google rating goal" and its one chip. The chip drops below the title when the
 * card is too narrow for both, rather than squeezing the title onto two lines.
 */
export function RatingGoalCardHeader({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <CardTitle
        as="h2"
        id={RATING_GOAL_HEADING_ID}
        tabIndex={-1}
        className="whitespace-nowrap outline-none"
      >
        Google rating goal
      </CardTitle>
      {children}
    </CardHeader>
  )
}
