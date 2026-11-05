// Averages have no pace verdict. Show the governed average only above its sample floor.
// A stale change refreshes and reopens on the latest goal; closing restores focus to
// the opener or page title.

import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import type { PortalGoalSinglePageView } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { GoalDetailLayout, GoalTiles } from './goal-detail-layout'
import type { PortalGoalAverageChangeCommands } from './portal-goal-average-change-sheet'
import { PortalGoalChanges } from './portal-goal-changes'
import { PortalGoalMonthStrip } from './portal-goal-month-strip'
import { PAGE_HEADER_ID, focusPortalGoalPageTitle } from './portal-goal-page'
import { usePortalGoalPageActions } from './portal-goal-page-actions'
import { TILES_LABEL, TILES_TITLE, stripChips } from './portal-goal-page-view'
import {
  averageGoalLine,
  averageTiles,
  goalStateLine,
  singleGoalTitle,
} from './portal-goal-single-page-view'
import type { PortalGoalStopCommands } from './portal-goal-stop-dialog'

type AverageView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'average' }>>

const loadSheet = () => import('./portal-goal-average-change-sheet')
const AverageChangeSheet = lazy(() =>
  loadSheet().then((module) => ({ default: module.PortalGoalAverageChangeSheet })),
)

/** What the page's change does: the sheet's commands, and a way to read the goal again. */
export type PortalGoalAverageCommands = PortalGoalAverageChangeCommands &
  Readonly<{
    /** Reads the page again, for the sheet a change refused as behind opens afresh on. */
    reread: () => Promise<AverageView['goal'] | undefined>
  }>

type Props = Readonly<{
  propertyId: string
  propertyName: string
  view: AverageView
  /** `goal.update`: "Change number". */
  canChange: boolean
  /** `goal.cancel`: "Stop this goal". */
  canStop: boolean
  commands: PortalGoalAverageCommands
  stop: PortalGoalStopCommands
  personName: (userId: string) => string | null
}>

type Opening = Readonly<{
  goal: AverageView['goal']
  notice: unknown
  open: boolean
  key: number
}>

/** The change sheet: opened by "Change number", afresh on the latest when it is behind. */
function useAverageChangeSheet(props: Props) {
  const { view, commands, propertyId } = props
  const [opening, setOpening] = useState<Opening | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const settled = useRef(false)
  const doorShown = props.canChange && view.goal.change !== null
  useEffect(() => {
    if (doorShown) void loadSheet()
  }, [doorShown])
  const open = () => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement ? active : null
    settled.current = false
    setOpening((current) => ({
      goal: view.goal,
      notice: null,
      open: true,
      key: (current?.key ?? 0) + 1,
    }))
  }
  const setOpen = (next: boolean) =>
    setOpening((current) => (current === null ? null : { ...current, open: next }))
  // F-1, F-2, F-4: the latest goal, and a fresh sheet on it that says why; a
  // latest goal that takes no change (it was stopped) closes the sheet.
  const onBehind = (notice: unknown) =>
    void commands.reread().then((latest) =>
      setOpening((current) => {
        if (current === null || !current.open) return current
        if (latest !== undefined && latest.change === null) {
          return { ...current, open: false }
        }
        const goal = latest ?? current.goal
        return { ...current, goal, notice, key: current.key + 1 }
      }),
    )
  const change = opening?.goal.change ?? null
  const sheet =
    opening === null || change === null ? null : (
      <Suspense fallback={null}>
        <AverageChangeSheet
          key={opening.key}
          open={opening.open}
          onOpenChange={setOpen}
          onSettled={() => {
            settled.current = true
            setOpen(false)
          }}
          onBehind={onBehind}
          propertyId={propertyId}
          goal={opening.goal}
          change={change}
          commands={commands}
          notice={opening.notice}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opening.open) return
            if (!settled.current && opener.current?.isConnected) opener.current.focus()
            else focusPortalGoalPageTitle()
          }}
        />
      </Suspense>
    )
  return { open, sheet }
}

export function PortalGoalAveragePage(props: Props) {
  const { propertyId, propertyName, view, canStop, stop } = props
  const { goal } = view
  const title = singleGoalTitle(view.subject, 'average')
  const sheet = useAverageChangeSheet(props)
  const { actions, dialog } = usePortalGoalPageActions({
    goal: { ...goal, measure: null },
    name: title,
    kind: 'single',
    propertyId,
    canChange: props.canChange,
    canStop,
    onChangeNumber: sheet.open,
    stop,
    focusTitle: focusPortalGoalPageTitle,
  })
  const tilesId = useId()
  const tiles = averageTiles(goal)
  const state = goalStateLine(goal)
  return (
    <PageShell>
      <div id={PAGE_HEADER_ID}>
        <PageHeader
          title={title}
          breadcrumbs={trailCrumbs('goals', { propertyId, propertyName }, title)}
          actions={actions}
        />
      </div>
      <GoalDetailLayout slot="portal-goal-average-detail">
        {state === null ? null : (
          <Alert variant="info">
            <AlertDescription>{state}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">{averageGoalLine(view.subject)}</p>
        <GoalTiles
          title={TILES_TITLE}
          headingId={tilesId}
          label={TILES_LABEL}
          tiles={tiles}
        />
        <PortalGoalMonthStrip chips={stripChips(view.months, view.today)} />
        <PortalGoalChanges
          changes={view.changes}
          personName={props.personName}
          today={view.today}
        />
      </GoalDetailLayout>
      {dialog}
      {sheet.sheet}
    </PageShell>
  )
}
