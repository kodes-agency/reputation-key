// Stop is irreversible. Keep the dialog outside its menu and preserve the opening
// snapshot across refreshes. A refusal leaves it open. Running goals count through
// month end; an unstarted goal frees its month immediately.

import type { StopMonthlyPortalGoalRequest } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import {
  goalRefusalCode,
  withGoalRefusals,
} from '../../../../components/goals/goal-refusal'
import { PORTAL_GOAL_BEHIND } from './portal-goal-sheet-refusals'
import { SINGLE_GOAL_WORDS } from './portal-goal-single-page-view'
import {
  PORTAL_STOP_REFUSALS,
  stopWords,
  type PortalGoalStopFacts,
  type PortalGoalStopKind,
} from './portal-goal-stop-view'

/** What Stop sends, and what follows it, handed down by the page. */
export type PortalGoalStopCommands = Readonly<{
  stopMonthlyPortalGoalFn: (
    input: Readonly<{ data: StopMonthlyPortalGoalRequest }>,
  ) => Promise<unknown>
  /** Stopped: the reads are marked stale and the page moves on. */
  onStopped: () => Promise<void>
  /** A refusal that means the page is behind: it is read again. */
  onRefused: () => Promise<void>
}>

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
  /** The goal as it was when the dialog opened. */
  goal: PortalGoalStopFacts
  /** The Monthly portal goal, or a goal with a page of its own. */
  kind?: PortalGoalStopKind
  commands: PortalGoalStopCommands
  /** Where the focus goes on closing, for a dialog opened from a menu. */
  onCloseAutoFocus?: (event: Event) => void
}>

export function PortalGoalStopDialog({
  open,
  onOpenChange,
  propertyId,
  goal,
  kind = 'monthly',
  commands,
  onCloseAutoFocus,
}: Props) {
  const words = stopWords(goal, kind)
  // No error toast: the dialog says a refusal where the button was pressed.
  const stop = useActionMutation(
    withGoalRefusals(commands.stopMonthlyPortalGoalFn, PORTAL_STOP_REFUSALS),
    {
      successMessage:
        kind === 'single' ? SINGLE_GOAL_WORDS.stopped : 'Monthly portal goal stopped',
      onSuccess: commands.onStopped,
      onError: (error) => {
        const code = goalRefusalCode(error) ?? ''
        if (code === 'invalid_transition' || PORTAL_GOAL_BEHIND.has(code)) {
          void commands.onRefused()
        }
      },
    },
  )
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={words.title}
      description={words.description}
      cancelLabel={words.cancel}
      confirmLabel={words.confirm}
      tone="destructive"
      onConfirm={() => stop({ data: { propertyId, programId: goal.programId } })}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
