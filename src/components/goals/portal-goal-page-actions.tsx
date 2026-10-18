// The Monthly portal goal page's actions (copy deck P-3, X-5; PLAN PG-14):
// "Change number", which opens the change sheet on the goal's measure, and the
// goal's "more actions" menu with the other measure ("Count scans instead",
// from the next month) and "Stop this goal", the destructive item. Each is
// drawn only for someone who may do it. The menu's items hand over once the
// menu has closed, with the focus back on its trigger, so the sheet or the
// dialog they open returns it there. A goal for one Portal or a group has the
// same actions on its own page, its menu named after the page (PLAN PG-21); the
// average, with no number to change here, has Stop alone.
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-intent'
import {
  PortalGoalStopDialog,
  type PortalGoalStopCommands,
} from './portal-goal-stop-dialog'
import type { PortalGoalStopFacts, PortalGoalStopKind } from './portal-goal-stop-view'
import { switchOf } from './portal-goal-words'

type Props = Readonly<{
  /** The goal, with the measure it counts; none for the average, which changes nothing here. */
  goal: Pick<PortalGoalOfCard, 'status' | 'change'> &
    Readonly<{ measure: PortalGoalMeasure | null }>
  /** What the menu is named for: the page's goal. */
  name?: string
  /** `goal.update`: change the number, or the measure from next month. */
  canChange: boolean
  /** `goal.cancel`: stop the goal. */
  canStop: boolean
  openSheet: (intent: PortalGoalSheetIntent) => void
  /** Opens the Stop dialog, which the page holds. */
  onStop: () => void
  /** The menu's trigger, which the page's Stop dialog hands the focus back to. */
  triggerRef: RefObject<HTMLButtonElement | null>
}>

type Chosen = Readonly<{ kind: 'measure' } | { kind: 'stop' }>

function PortalGoalPageActions({
  goal,
  name = PORTAL_GOAL_NAME,
  canChange: mayChange,
  canStop,
  openSheet,
  onStop,
  triggerRef: trigger,
}: Props) {
  const chosen = useRef<Chosen | null>(null)
  // A stopped goal takes no change and no second stop.
  const { measure } = goal
  if (goal.status === 'ended' || goal.change === null) return null
  const canChange = mayChange && measure !== null
  const other = measure === null ? null : switchOf(measure)
  const handOver = (event: Event) => {
    const item = chosen.current
    chosen.current = null
    if (item === null) return
    event.preventDefault()
    trigger.current?.focus()
    if (item.kind === 'stop') onStop()
    else if (other !== null) openSheet({ mode: 'change', measure: other.measure })
  }
  return (
    <>
      {canChange ? (
        <Button variant="outline" onClick={() => openSheet({ mode: 'change', measure })}>
          Change number
        </Button>
      ) : null}
      {canChange || canStop ? (
        <RowActionsMenu
          ref={trigger}
          name={name}
          variant="outline"
          onCloseAutoFocus={handOver}
        >
          {canChange && other !== null ? (
            <RowActionsItem
              opensDialog
              onSelect={() => {
                chosen.current = { kind: 'measure' }
              }}
            >
              {other.label}
            </RowActionsItem>
          ) : null}
          {canStop ? (
            <RowActionsItem
              destructive
              opensDialog
              onSelect={() => {
                chosen.current = { kind: 'stop' }
              }}
            >
              Stop this goal
            </RowActionsItem>
          ) : null}
        </RowActionsMenu>
      ) : null}
    </>
  )
}

/** A goal the page's actions are drawn for: what Stop says, and the measure a change is in. */
type ActedOn = PortalGoalStopFacts & Readonly<{ measure: PortalGoalMeasure | null }>

/**
 * P-3: a goal page's actions while its goal can change, and the Stop dialog
 * they open, held outside the menu and the header so a refusal that reads the
 * page again keeps it, on the goal as it was when it opened. The focus goes
 * back to the menu it was opened from, or to the page's title once that is gone.
 */
export function usePortalGoalPageActions(
  input: Readonly<{
    /** The goal, while the page draws one with a way to change it; else null. */
    goal: ActedOn | null
    name?: string
    kind: PortalGoalStopKind
    propertyId: string
    canChange: boolean
    canStop: boolean
    openSheet?: (intent: PortalGoalSheetIntent) => void
    stop: PortalGoalStopCommands
    focusTitle: () => void
  }>,
): Readonly<{ actions: ReactNode; dialog: ReactNode }> {
  const [stopping, setStopping] = useState<Readonly<{
    goal: ActedOn
    open: boolean
  }> | null>(null)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const { goal } = input
  const actions =
    goal === null ? null : (
      <PortalGoalPageActions
        goal={goal}
        name={input.name}
        canChange={input.canChange}
        canStop={input.canStop}
        openSheet={input.openSheet ?? (() => undefined)}
        onStop={() => setStopping({ goal, open: true })}
        triggerRef={menuTrigger}
      />
    )
  const dialog =
    stopping === null ? null : (
      <PortalGoalStopDialog
        open={stopping.open}
        onOpenChange={(open) => setStopping({ ...stopping, open })}
        propertyId={input.propertyId}
        goal={stopping.goal}
        kind={input.kind}
        commands={input.stop}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (menuTrigger.current?.isConnected) menuTrigger.current.focus()
          else input.focusTitle()
        }}
      />
    )
  return { actions, dialog }
}
