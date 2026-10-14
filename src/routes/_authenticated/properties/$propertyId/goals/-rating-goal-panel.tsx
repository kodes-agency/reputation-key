// The Goals page's Google part: the Google rating goal section on the Active
// view, its reached and ended goals on the History view, and the wizard its
// doors open. Its reads are its own: the loader primes the card, the setup and
// the History all at once, beside the Portal goals' reads, and a failed one
// says so in this section and holds nothing else back. The setup and History
// are drawn from only while there is no active goal (the empty states, the
// wizard, and a goal reached or ended lately).
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RatingGoalHistory } from '#/components/goals/rating-goal-history'
import { RatingGoalSection } from '#/components/goals/rating-goal-section'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ratingGoalHistoryQuery, ratingGoalSetupQuery } from './-rating-goal-queries'
import {
  preloadRatingGoalWizard,
  regionRead,
  useRatingGoalCard,
  useRatingGoalWizard,
} from './-rating-goal-wizard-host'

type Props = Readonly<{
  propertyId: string
  timezone: string
  view: 'active' | 'history'
  /** The done screen's one next step (portal goals, or a first Portal), and too few reviews' link. */
  hasPortals: boolean
}>

export function RatingGoalPanel({ propertyId, timezone, view, hasPortals }: Props) {
  const [now] = useState(() => new Date())
  const { can } = usePermissions()
  const { card, noActiveGoal } = useRatingGoalCard(propertyId)
  const setup = useQuery({
    ...ratingGoalSetupQuery(propertyId),
    enabled: view === 'active' && noActiveGoal,
    retry: false,
  })
  const history = useQuery({
    ...ratingGoalHistoryQuery(propertyId),
    enabled: view === 'history' || noActiveGoal,
    retry: false,
  })
  const { start, wizard } = useRatingGoalWizard(propertyId, { hasPortals })
  // A door to the wizard is on screen when there is no active goal: fetch its
  // chunk now, so the click opens it at once.
  const doorShown = can('goal.create') && card.data?.state !== 'active'
  useEffect(() => {
    if (doorShown) preloadRatingGoalWizard()
  }, [doorShown])
  return (
    <>
      {view === 'active' ? (
        <RatingGoalSection
          propertyId={propertyId}
          timezone={timezone}
          now={now}
          card={{ ...regionRead(card), readAt: new Date(card.dataUpdatedAt) }}
          setup={regionRead(setup)}
          history={regionRead(history)}
          hasPortals={hasPortals}
          onStart={start}
        />
      ) : (
        <RatingGoalHistory history={regionRead(history)} timezone={timezone} now={now} />
      )}
      {wizard}
    </>
  )
}
