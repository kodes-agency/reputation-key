// Results links require goal.update, matching the results page's gate.

import type { ReactNode } from 'react'
import { TouchInlineLink } from '#/components/ui/inline-touch-link'
import {
  ENDED_PORTAL_GOALS_HASH,
  allResultsLink,
  anyPortalGoalMonthClosed,
  endedPortalGoalsLink,
} from './portal-goal-results-foot'

type Props = Readonly<{
  propertyId: string
  /** Every Portal goal of the Property, ended ones included, with its months. */
  programs: Parameters<typeof anyPortalGoalMonthClosed>[0]
}>

/**
 * A foot link to the results page; `toEnded` lands on its ended goals
 * (`#ended`), whose title then takes the focus.
 */
function ResultsLink({
  propertyId,
  toEnded = false,
  children,
}: Readonly<{ propertyId: string; toEnded?: boolean; children: ReactNode }>) {
  return (
    <TouchInlineLink
      to="/properties/$propertyId/goals/portal-results"
      params={{ propertyId }}
      hash={toEnded ? ENDED_PORTAL_GOALS_HASH : undefined}
      state={toEnded ? { focusEndedPortalGoals: true } : undefined}
      className="self-start text-sm"
    >
      {children}
    </TouchInlineLink>
  )
}

export function PortalGoalResultsLinks({ propertyId, programs }: Props) {
  const allResults = allResultsLink(anyPortalGoalMonthClosed(programs))
  const ended = endedPortalGoalsLink(programs)
  if (allResults === null && ended === null) return null
  return (
    <div className="flex flex-col gap-2">
      {allResults === null ? null : (
        <ResultsLink propertyId={propertyId}>{allResults}</ResultsLink>
      )}
      {ended === null ? null : (
        <ResultsLink propertyId={propertyId} toEnded>
          {ended}
        </ResultsLink>
      )}
    </div>
  )
}
