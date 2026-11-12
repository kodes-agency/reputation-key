// Set submits the offered month, measure and number, marked recommended only when it
// matches. Keep the draft above the responsive frame and mount afresh per opening.
// Stale months refresh the offers; a goal already set elsewhere closes the sheet.
// Pending commands prevent dismissal.

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  PortalGoalOfCard,
  PortalGoalSheetFacts,
  ReviseMonthlyPortalGoalRequest,
} from '#/contexts/reporting/monthly-goals/contracts'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import {
  goalRefusalCode,
  withGoalRefusals,
} from '../../../../components/goals/goal-refusal'
import { GoalSheetFrame } from '../../../../components/goals/goal-sheet-frame'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalChangeSheet } from './portal-goal-change-sheet'
import { goalSetToast } from './portal-goal-offer-words'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import { PORTAL_GOAL_BEHIND, PORTAL_SHEET_REFUSALS } from './portal-goal-sheet-refusals'
import {
  changedDraft,
  openingDraft,
  portalGoalSheetModel,
  type PortalGoalSetIntent,
  type PortalGoalSheetChange,
  type PortalGoalSheetIntent,
} from './portal-goal-sheet-view'

/** What the sheet sends: the set, and the two changes. */
export type PortalGoalSheetCommands = Pick<
  PortalGoalCommands,
  'setMonthlyPortalGoalFn' | 'onSet'
> &
  Readonly<{
    changeMonthlyPortalGoalNowFn: (
      input: Readonly<{ data: ChangeMonthlyPortalGoalNowRequest }>,
    ) => Promise<unknown>
    reviseMonthlyPortalGoalFn: (
      input: Readonly<{ data: ReviseMonthlyPortalGoalRequest }>,
    ) => Promise<unknown>
  }>

export type PortalGoalSheetProps = Readonly<{
  open: boolean
  /** Cancel, Escape, the overlay or the corner close. */
  onOpenChange: (open: boolean) => void
  /**
   * The goal was set or changed, here or a moment ago elsewhere, and the card
   * has been read again: the sheet is done, and the goal's title takes the focus.
   */
  onSettled: () => void
  propertyId: string
  facts: PortalGoalSheetFacts
  intent: PortalGoalSheetIntent
  commands: PortalGoalSheetCommands
  /** The goal a change is for, as the sheet opened on it; null when setting. */
  goal?: PortalGoalOfCard | null
  /** A refusal the sheet opens with, said again on the latest. */
  notice?: unknown
  /**
   * A stale-goal refusal on a change: the sheet is behind the goal, and the host
   * reads it again and opens the sheet afresh on the latest.
   */
  onBehind?: (error: unknown) => void
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
  /** The sheet's clock, for "starts below pace"; now unless a story fixes it. */
  now?: Date
  /**
   * The change sheet's title on a goal other than the Monthly portal goal, a
   * Portal's or a group's on its own page; else the sheet's own.
   */
  changeTitle?: string
  /**
   * The change sheet offers the other measure: false on a Portal's or a
   * group's page when its subject already holds a goal for it.
   */
  canSwitch?: boolean
}>

/** Set, sent once however often it is pressed, and what follows it. */
function useSetCommand(props: PortalGoalSheetProps) {
  const sending = useRef(false)
  const { commands, onSettled } = props
  const settle = async () => {
    await commands.onSet()
    onSettled()
  }
  const set = useActionMutation(
    withGoalRefusals(commands.setMonthlyPortalGoalFn, PORTAL_SHEET_REFUSALS),
    {
      onSuccess: async (_output, { data }) => {
        toast.success(goalSetToast(data.startMonth, data.metric, data.targetValue))
        await settle()
      },
      onError: (error) => {
        const code = goalRefusalCode(error) ?? ''
        if (code === 'subject_has_goal') {
          // nothing is left to set here; the card shows the goal that was.
          void settle().then(() => toast.error(actionErrorMessage(error)))
        } else if (PORTAL_GOAL_BEHIND.has(code)) {
          void commands.onSet()
        }
      },
    },
  )
  const send = (data: Parameters<typeof set>[0]['data']) => {
    if (sending.current) return
    sending.current = true
    void set({ data })
      // Held by the mutation: the banner says it above the footer.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  // A subject that already holds a goal is the toast's to say, once the sheet has closed.
  const shown = goalRefusalCode(set.error) === 'subject_has_goal' ? null : set.error
  return { send, pending: set.isPending, error: shown }
}

function PortalGoalSetSheet(
  props: PortalGoalSheetProps & Readonly<{ intent: PortalGoalSetIntent }>,
) {
  const { facts, propertyId } = props
  const [draft, setDraft] = useState(() => openingDraft(facts, props.intent))
  const model = portalGoalSheetModel(draft, facts)
  const { send, pending, error } = useSetCommand(props)
  const onChange = (change: PortalGoalSheetChange) =>
    setDraft((current) => changedDraft(current, change, facts))
  return (
    <GoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      marker="data-portal-goal-sheet"
      title={model.title}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalSheetBody
          model={model}
          small={phone}
          pending={pending}
          error={error}
          onChange={onChange}
          onSubmit={() => {
            if (model.submission !== null) send({ propertyId, ...model.submission })
          }}
        />
      )}
    </GoalSheetFrame>
  )
}

export function PortalGoalSheet(props: PortalGoalSheetProps) {
  const { intent, goal } = props
  if (intent.mode !== 'change') return <PortalGoalSetSheet {...props} intent={intent} />
  // A change needs the goal and what it is made against; a stopped goal takes none.
  if (goal === undefined || goal === null || goal.change === null) return null
  return (
    <PortalGoalChangeSheet
      {...props}
      goal={goal}
      change={goal.change}
      measure={intent.measure}
    />
  )
}
