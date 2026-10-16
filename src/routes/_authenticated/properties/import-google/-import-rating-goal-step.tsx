// The Google import's last step for a single Property, as the route wires it:
// only for a manager who may set a goal, the goal's setup read (read again
// every 30 seconds while Google's first numbers are not in), the goal commands,
// "Not now" and "Go to goals". What it shows is `SetupRatingGoalStep`'s.
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { waitsForGoogle } from '#/components/features/property-setup/setup-rating-goal-offer'
import { SetupRatingGoalStep } from '#/components/features/property-setup/setup-rating-goal-step'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import {
  ratingGoalCommands,
  ratingGoalSetupQuery,
} from '../$propertyId/goals/-rating-goal-queries'
import { regionRead } from '../$propertyId/goals/-rating-goal-wizard-host'
import { useRatingGoalNotNowAction } from '../$propertyId/goals/-rating-goal-not-now'

/** How often the step asks again while Google's first numbers are not in. */
const WAIT_FOR_GOOGLE_MS = 30_000

export function ImportRatingGoalStep({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const allowed = can('goal.create') && has('goal.use')
  return allowed ? <AllowedImportRatingGoalStep propertyId={propertyId} /> : null
}

function AllowedImportRatingGoalStep({ propertyId }: Readonly<{ propertyId: string }>) {
  const navigate = useNavigate()
  const setup = useQuery({
    ...ratingGoalSetupQuery(propertyId),
    retry: false,
    refetchInterval: (query) =>
      waitsForGoogle(query.state.data) && query.state.status !== 'error'
        ? WAIT_FOR_GOOGLE_MS
        : false,
  })
  const notNow = useRatingGoalNotNowAction(propertyId)
  // Only for the wizard's header: the step works without it.
  const property = useQuery({ ...propertyQuery(propertyId), retry: false })
  return (
    <SetupRatingGoalStep
      propertyId={propertyId}
      propertyName={property.data?.property.name}
      setup={regionRead(setup)}
      setRatingGoalFn={ratingGoalCommands.setRatingGoal}
      changeRatingGoalFn={ratingGoalCommands.changeRatingGoal}
      onNotNow={() => notNow({ data: { propertyId } })}
      onGoToGoals={() =>
        void navigate({ to: '/properties/$propertyId/goals', params: { propertyId } })
      }
    />
  )
}
