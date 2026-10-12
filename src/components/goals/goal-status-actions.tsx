import type { GoalProgram } from '#/contexts/reporting/application/public-api'
import { Button } from '#/components/ui/button'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'

type GoalStatus = GoalProgram['status']

type GoalStatusActionsProps = Readonly<{
  goalName: string
  /** The goal's current status; an ended goal has no actions and is not rendered. */
  status: Exclude<GoalStatus, 'ended'>
  pending: boolean
  /** Pause or Resume: acts at once, and a refusal is the caller's toast. */
  onChange: (status: 'active' | 'paused') => void
  /** End goal, after the confirmation: a refusal rejects and the dialog says it. */
  onEnd: () => Promise<unknown>
}>

/**
 * Pause or Resume while the goal runs, and End goal for any goal that has not
 * ended. Ending is terminal (the domain allows no transition out of `ended`),
 * so it confirms in the destructive tone; pausing is undone by resuming.
 */
export function GoalStatusActions({
  goalName,
  status,
  pending,
  onChange,
  onEnd,
}: GoalStatusActionsProps) {
  const running = status === 'active' || status === 'paused'
  return (
    <>
      {running ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => onChange(status === 'paused' ? 'active' : 'paused')}
        >
          {status === 'paused' ? 'Resume' : 'Pause'}
        </Button>
      ) : null}
      <ConfirmationDialog
        trigger={
          <ConfirmationTrigger tone="destructive" disabled={pending}>
            End goal
          </ConfirmationTrigger>
        }
        title={`End “${goalName}”?`}
        description="Ending a goal is final. It moves to History and cannot be resumed or revised. The results it has already earned are kept."
        cancelLabel="Keep goal"
        confirmLabel="End goal"
        pendingLabel="Ending…"
        tone="destructive"
        onConfirm={onEnd}
      />
    </>
  )
}
