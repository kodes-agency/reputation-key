// The Property Overview's Google rating goal: its reads (the card; the setup and
// History only while there is no active goal) and the wizard its prompt or its
// "Set your next goal" opens. The loader primes them
// (`prefetchRatingGoalOverview`); a read that fails leaves the Overview without
// the goal, never in an error.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RatingGoalOverview } from '#/components/goals/rating-goal-overview'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ratingGoalHistoryQuery, ratingGoalSetupQuery } from './-rating-goal-queries'
import {
  preloadRatingGoalWizard,
  useRatingGoalCard,
  useRatingGoalWizard,
} from './-rating-goal-wizard-host'

type Props = Readonly<{
  propertyId: string
  timezone: string
  /** The wizard's done screen offers portal goals when there are Portals, a Portal when not. */
  hasPortals: boolean
}>

export function OverviewRatingGoal({ propertyId, timezone, hasPortals }: Props) {
  const { card, noActiveGoal } = useRatingGoalCard(propertyId)
  const { can } = usePermissions()
  const [now] = useState(() => new Date())
  const setup = useQuery({
    ...ratingGoalSetupQuery(propertyId),
    enabled: noActiveGoal,
    retry: false,
  })
  const history = useQuery({
    ...ratingGoalHistoryQuery(propertyId),
    enabled: noActiveGoal,
    retry: false,
  })
  const { start, wizard } = useRatingGoalWizard(propertyId, { hasPortals })
  // A door to the wizard is on screen: fetch its chunk now, so the click opens it at once.
  const doorShown = can('goal.create') && noActiveGoal
  useEffect(() => {
    if (doorShown) preloadRatingGoalWizard()
  }, [doorShown])
  return (
    <>
      <RatingGoalOverview
        propertyId={propertyId}
        timezone={timezone}
        now={now}
        card={card.data}
        cardReadAt={new Date(card.dataUpdatedAt)}
        setup={setup.data}
        history={history.data}
        onStart={start}
      />
      {wizard}
    </>
  )
}
