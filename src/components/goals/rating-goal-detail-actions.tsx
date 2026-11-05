// Ending is irreversible, so use destructive confirmation and keep it open on refusal.
// Reached or ended goals retain only the Portals link.

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
