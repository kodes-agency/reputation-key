// What the detail page lets a manager do with an active Google rating goal:
// open the Portals that ask guests for reviews (portal.read, round 5, mock D3),
// change its plan, which opens the setup on it (goal.update), or end it
// (goal.cancel). A goal the read found reached or ended keeps only the way to
// the Portals; the Goals page offers the next goal.
// Ending is final, so it confirms in the destructive tone; the confirmation
// stays open on a refusal and says it.
import { Link } from '@tanstack/react-router'
import type {
  RatingGoalCardView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { Button } from '#/components/ui/button'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ratingText } from './rating-goal-view'

type Props = Readonly<{
  propertyId: string
  goal: RatingGoalCardView
  /** The setup read: a goal that keeps a number can change only to a plan it offers. */
  setup: RatingGoalSetupView | undefined
  onChange: () => void
  /** Ends the goal; rejects with the refusal, which the confirmation says. */
  onEnd: () => Promise<unknown>
}>

export function RatingGoalDetailActions({
  propertyId,
  goal,
  setup,
  onChange,
  onEnd,
}: Props) {
  const { can } = usePermissions()
  const active = goal.state === 'active'
  const keep = goal.mode === 'keep'
  const changeOffered = !keep || setup?.offersClimb === true
  return (
    <>
      {can('portal.read') ? (
        <Button asChild variant="ghost">
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            Open Portals
          </Link>
        </Button>
      ) : null}
      {active && can('goal.update') && changeOffered ? (
        <Button variant="outline" onClick={onChange}>
          {keep ? 'Aim for a higher number' : 'Change plan'}
        </Button>
      ) : null}
      {active && can('goal.cancel') ? (
        <ConfirmationDialog
          trigger={<ConfirmationTrigger tone="destructive">End goal</ConfirmationTrigger>}
          title="End the Google rating goal?"
          description={`Ending is final: the goal to ${keep ? 'keep' : 'reach'} ${ratingText(goal.target)} on Google moves to History. You can set a new goal at any time.`}
          cancelLabel="Keep goal"
          confirmLabel="End goal"
          pendingLabel="Ending…"
          tone="destructive"
          onConfirm={onEnd}
        />
      ) : null}
    </>
  )
}
