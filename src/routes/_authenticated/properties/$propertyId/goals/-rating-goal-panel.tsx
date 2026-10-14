// The Goals page's Google part: the Google rating goal section on the Active
// view, its reached and ended goals on the History view, and the wizard its
// doors open. It reads apart from the Portal goals, so a slow or failed Google
// read never holds them back. The card is primed by the loader; the setup is
// read only while there is no goal to show (the empty states and the wizard).
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RatingGoalHistory } from '#/components/goals/rating-goal-history'
import { RatingGoalSection } from '#/components/goals/rating-goal-section'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  ratingGoalCardQuery,
  ratingGoalHistoryQuery,
  ratingGoalSetupQuery,
} from './-rating-goal-queries'
import {
  preloadRatingGoalWizard,
  regionRead,
  useRatingGoalWizard,
} from './-rating-goal-wizard-host'

type Props = Readonly<{
  propertyId: string
  timezone: string
  view: 'active' | 'history'
  /** The done screen's one next step: portal goals, or a first Portal. */
  hasPortals: boolean
}>

export function RatingGoalPanel({ propertyId, timezone, view, hasPortals }: Props) {
  const [now] = useState(() => new Date())
  const { can } = usePermissions()
  const card = useQuery({ ...ratingGoalCardQuery(propertyId), retry: false })
  const noGoal = card.data === null
  const setup = useQuery({
    ...ratingGoalSetupQuery(propertyId),
    enabled: view === 'active' && noGoal,
    retry: false,
  })
  const history = useQuery({
    ...ratingGoalHistoryQuery(propertyId),
    enabled: view === 'history',
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
          onStart={start}
        />
      ) : (
        <RatingGoalHistory history={regionRead(history)} timezone={timezone} now={now} />
      )}
      {wizard}
    </>
  )
}
