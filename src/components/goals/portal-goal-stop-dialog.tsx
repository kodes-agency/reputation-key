// Stop the Monthly portal goal (copy deck X-1…X-4, F-5, P-16; PLAN PG-14): a
// confirmation in the destructive tone, since a stop is not taken back. A
// running goal keeps its month to the last day, with its result, and frees the
// months after it; a goal that has not started frees its month at once. On a
// stop a toast says so and the page hands over (it leaves for the Goals page);
// a refusal is said in the dialog, which stays open, and the page is read
// again (F-5: the goal was already stopped). The dialog is held by the page,
// outside the menu that opens it, and words the goal as it was when it opened.
// A goal for one Portal, a group or the average is stopped from its own page
// the same way (PLAN PG-21), as "this portal goal".
import type { StopMonthlyPortalGoalRequest } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
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
