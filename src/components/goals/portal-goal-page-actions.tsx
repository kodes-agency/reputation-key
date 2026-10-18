// The Monthly portal goal page's actions (copy deck P-3, X-5; PLAN PG-14):
// "Change number", which opens the change sheet on the goal's measure, and the
// goal's "more actions" menu with the other measure ("Count scans instead",
// from the next month) and "Stop this goal", the destructive item. Each is
// drawn only for someone who may do it. The menu's items hand over once the
// menu has closed, with the focus back on its trigger, so the sheet or the
// dialog they open returns it there.
import { useRef, type RefObject } from 'react'
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-intent'
import { switchOf } from './portal-goal-words'

type Props = Readonly<{
  goal: PortalGoalOfCard
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

export function PortalGoalPageActions({
  goal,
  canChange,
  canStop,
  openSheet,
  onStop,
  triggerRef: trigger,
}: Props) {
  const chosen = useRef<Chosen | null>(null)
  // A stopped goal takes no change and no second stop.
  if (goal.status === 'ended' || goal.change === null) return null
  const other = switchOf(goal.measure)
  const handOver = (event: Event) => {
    const item = chosen.current
    chosen.current = null
    if (item === null) return
    event.preventDefault()
    trigger.current?.focus()
    if (item.kind === 'stop') onStop()
    else openSheet({ mode: 'change', measure: other.measure })
  }
  return (
    <>
      {canChange ? (
        <Button
          variant="outline"
          onClick={() => openSheet({ mode: 'change', measure: goal.measure })}
        >
          Change number
        </Button>
      ) : null}
      {canChange || canStop ? (
        <RowActionsMenu
          ref={trigger}
          name={PORTAL_GOAL_NAME}
          variant="outline"
          onCloseAutoFocus={handOver}
        >
          {canChange ? (
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
