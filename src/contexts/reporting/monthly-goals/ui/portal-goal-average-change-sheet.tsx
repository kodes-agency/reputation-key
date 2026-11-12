// Work from the goal as the sheet opened on it. Stale revisions or month boundaries
// refresh and reopen the sheet with the refusal preserved; a stopped goal closes it. An
// average has no recommended value.

import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalChangeFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/monthly-goals/contracts'
import type { PortalGoalAverageOfPage } from '#/contexts/reporting/monthly-goals/contracts'
import { GoalSheetFrame } from '../../../../components/goals/goal-sheet-frame'
import { PortalGoalAverageChangeBody } from './portal-goal-average-change-body'
import {
  changedAverageDraft,
  openingAverageDraft,
  portalGoalAverageChangeModel,
} from './portal-goal-average-change-view'
import { usePortalGoalChangeCommand } from './portal-goal-change-command'
import {
  portalGoalChangeSend,
  usePortalGoalChangeDraft,
} from './portal-goal-change-draft'
import { SINGLE_GOAL_WORDS } from './portal-goal-single-page-view'

/** What the sheet sends, and what follows it, handed down by the page. */
export type PortalGoalAverageChangeCommands = Readonly<{
  changeMonthlyPortalGoalNowFn: (
    input: Readonly<{ data: ChangeMonthlyPortalGoalNowRequest }>,
  ) => Promise<unknown>
  reviseMonthlyPortalGoalFn: (
    input: Readonly<{ data: ReviseMonthlyPortalGoalRequest }>,
  ) => Promise<unknown>
  /** Saved, or refused as behind: the page's reads are marked stale. */
  onChanged: () => Promise<void>
}>

export type PortalGoalAverageChangeSheetProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saved: the page has been read again, and the sheet is done. */
  onSettled: () => void
  /** The page reads the goal again and opens the sheet afresh. */
  onBehind: (error: unknown) => void
  propertyId: string
  /** The goal as the sheet opened on it (or read again after a stale-goal refusal). */
  goal: PortalGoalAverageOfPage
  change: PortalGoalChangeFacts
  commands: PortalGoalAverageChangeCommands
  /** A refusal the sheet opens with, said until the next press. */
  notice?: unknown
  onCloseAutoFocus?: (event: Event) => void
}>

// Used through the average page's on-demand import, which fallow does not follow.
// fallow-ignore-next-line unused-export
export function PortalGoalAverageChangeSheet(props: PortalGoalAverageChangeSheetProps) {
  const context = { goal: props.goal, change: props.change }
  const { draft, edit } = usePortalGoalChangeDraft(
    () => openingAverageDraft(context),
    changedAverageDraft,
  )
  const model = portalGoalAverageChangeModel(draft, context)
  const { send, pending, error, notice } = usePortalGoalChangeCommand({
    commands: props.commands,
    propertyId: props.propertyId,
    change: props.change,
    markStale: props.commands.onChanged,
    onSettled: props.onSettled,
    onBehind: props.onBehind,
    notice: props.notice,
  })
  return (
    <GoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      marker="data-portal-goal-sheet"
      title={SINGLE_GOAL_WORDS.changeTitle}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalAverageChangeBody
          model={model}
          small={phone}
          pending={pending}
          error={error}
          notice={notice}
          onChange={edit}
          onSubmit={() => {
            const sent = portalGoalChangeSend(model)
            if (sent !== null) send(sent)
          }}
        />
      )}
    </GoalSheetFrame>
  )
}
