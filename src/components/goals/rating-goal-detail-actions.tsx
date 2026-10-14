// What the detail page lets a manager do with an active Google rating goal:
// change its target or pace (goal.update), or end it (goal.cancel). A goal the
// read found reached or ended has no actions; the Goals page offers the next.
// Ending is final, so it confirms in the destructive tone; the confirmation
// stays open on a refusal and says it.
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
  goal: RatingGoalCardView
  /** The setup read: a goal that keeps a number can change only to a higher one it offers. */
  setup: RatingGoalSetupView | undefined
  onChange: () => void
  /** Ends the goal; rejects with the refusal, which the confirmation says. */
  onEnd: () => Promise<unknown>
}>

export function RatingGoalDetailActions({ goal, setup, onChange, onEnd }: Props) {
  const { can } = usePermissions()
  if (goal.state !== 'active') return null
  const keep = goal.mode === 'keep'
  const changeOffered = !keep || (setup?.stops.length ?? 0) > 0
  return (
    <>
      {can('goal.update') && changeOffered ? (
        <Button variant="outline" onClick={onChange}>
          {keep ? 'Aim for a higher number' : 'Change target or pace'}
        </Button>
      ) : null}
      {can('goal.cancel') ? (
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
