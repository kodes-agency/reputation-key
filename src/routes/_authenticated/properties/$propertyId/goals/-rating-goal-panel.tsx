// The Goals page's Google part: the Google rating goal section on the Active
// view, its reached and ended goals on the History view, and the wizard its
// doors open. Its reads are its own: the loader primes the card, the setup and
// the History all at once, beside the Portal goals' reads, and a failed one
// says so in this section and holds nothing else back. The setup and History
// are drawn from only while there is no active goal (the empty states, the
// wizard, and a goal reached or ended lately). Arrived at with `?start=`, it
// opens the wizard once both are read, where the page's own door would.
import { useEffect, useRef, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type {
  RatingGoalCardView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { hasFailed } from '#/components/hooks/is-retrying'
import { wizardOnArrival } from '#/components/goals/rating-goal-arrival'
import type { RatingGoalWizardIntent } from '#/components/goals/rating-goal-wizard-view'
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
  const { start, wizard } = useRatingGoalWizard(propertyId, { hasPortals })
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
