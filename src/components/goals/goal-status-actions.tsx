import type { GoalProgram } from '#/contexts/reporting/application/public-api'
import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'

type GoalStatus = GoalProgram['status']
type ChangeableStatus = Extract<GoalStatus, 'active' | 'paused' | 'ended'>

type GoalStatusActionsProps = Readonly<{
  goalName: string
  /** The goal's current status; an ended goal has no actions and is not rendered. */
  status: Exclude<GoalStatus, 'ended'>
  pending: boolean
  onChange: (status: ChangeableStatus) => void
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
          <Button variant="destructive" disabled={pending}>
            End goal
          </Button>
        }
        title={`End “${goalName}”?`}
        description="Ending a goal is final. It moves to History and cannot be resumed or revised. The results it has already earned are kept."
        cancelLabel="Keep goal"
        confirmLabel="End goal"
        pendingLabel="Ending…"
        pending={pending}
        tone="destructive"
        onConfirm={() => onChange('ended')}
      />
    </>
  )
}
