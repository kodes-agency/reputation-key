// Prime goal reads concurrently and isolate failures in this section. Arrival setup
// waits for setup and History, opening only where the page would offer it.

import { useEffect, useRef, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type {
  RatingGoalCardView,
  RatingGoalSetupView,
} from '#/contexts/reporting/rating-goals/contracts'
import { hasFailed } from '#/components/hooks/is-retrying'
import { wizardOnArrival } from '#/contexts/reporting/rating-goals/ui/rating-goal-arrival'
import type { RatingGoalWizardIntent } from '#/contexts/reporting/rating-goals/ui/rating-goal-wizard-view'
import { RatingGoalHistory } from '#/contexts/reporting/rating-goals/ui/rating-goal-history'
import type { PortalNextStep } from '#/contexts/reporting/rating-goals/ui/rating-goal-portal-step'
import { RatingGoalSection } from '#/contexts/reporting/rating-goals/ui/rating-goal-section'
import { RatingGoalViews } from '#/contexts/reporting/rating-goals/ui/rating-goal-views'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ratingGoalHistoryQuery, ratingGoalSetupQuery } from './-rating-goal-queries'
import {
  preloadRatingGoalWizard,
  regionRead,
  useRatingGoalCard,
  useRatingGoalRecapCommands,
  useRatingGoalWizard,
} from './-rating-goal-wizard-host'

type Props = Readonly<{
  propertyId: string
  timezone: string
  /** The section's tab (`?view=`): the card, or its History. */
  view: 'active' | 'history'
  /** Too few reviews' link: to the Portals when there are any, else to a first one. */
  hasPortals: boolean
  /** The wizard's done screen: the monthly portal goal once a Portal is live, else a first Portal. */
  portalNextStep: PortalNextStep
  /** Arrived at to set a goal (`?start=rating-goal`): open the wizard on arrival. */
  startOnArrival?: boolean
  /** The arrival is answered (the wizard opened, or there was nothing to open). */
  onArrivalHandled?: () => void
}>

/**
 * Opens the wizard once on arrival, when the card and the setup say a goal can
 * be set and the viewer may set it; answers the arrival either way, once.
 */
function useWizardOnArrival(
  arrival: Readonly<{
    asked: boolean
    card: UseQueryResult<RatingGoalCardView | null>
    setup: UseQueryResult<RatingGoalSetupView>
    canCreate: boolean
    start: (intent: RatingGoalWizardIntent) => void
    onHandled?: () => void
  }>,
) {
  const answered = useRef(false)
  const next = arrival.asked
    ? wizardOnArrival({
        card: arrival.card.data,
        cardFailed: hasFailed(arrival.card),
        setup: arrival.setup.data,
        setupFailed: hasFailed(arrival.setup),
        canCreate: arrival.canCreate,
      })
    : null
  useEffect(() => {
    if (next === null || next.kind === 'wait' || answered.current) return
    answered.current = true
    if (next.kind === 'open') arrival.start(next.intent)
    arrival.onHandled?.()
  })
}

export function RatingGoalPanel({
  propertyId,
  timezone,
  view,
  hasPortals,
  portalNextStep,
  startOnArrival = false,
  onArrivalHandled,
}: Props) {
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
  // The page's loader read the Property: only its name, for the wizard's header.
  const property = useQuery({ ...propertyQuery(propertyId), retry: false })
  const { start, wizard } = useRatingGoalWizard(propertyId, {
    portalNextStep,
    propertyName: property.data?.property.name,
  })
  const recap = useRatingGoalRecapCommands(propertyId)
  useWizardOnArrival({
    asked: startOnArrival && view === 'active',
    card,
    setup,
    canCreate: can('goal.create'),
    start,
    onHandled: onArrivalHandled,
  })
  // A door to the wizard is on screen when there is no active goal: fetch its
  // chunk now, so the click opens it at once.
  const doorShown = can('goal.create') && card.data?.state !== 'active'
  useEffect(() => {
    if (doorShown) preloadRatingGoalWizard()
  }, [doorShown])
  return (
    <>
      <RatingGoalViews propertyId={propertyId} view={view}>
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
            recap={recap}
          />
        ) : (
          <RatingGoalHistory
            history={regionRead(history)}
            timezone={timezone}
            now={now}
          />
        )}
      </RatingGoalViews>
      {wizard}
    </>
  )
}
