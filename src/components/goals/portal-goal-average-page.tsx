// The average private rating goal's page, on `$goalId` (PLAN PG-21): the goal
// page without a bar. Under its title, what the average is and where it counts
// (L-6), a stopped or paused goal's state, and its tile: this month's governed
// average against its level ("4.6 so far · goal 4.5"), or how many ratings it
// still needs ("More ratings needed · 6 of 10"), or its first month while it
// waits for it. Then each of its months and what changed, as on the Monthly
// portal goal's page. Its actions are "Change number", which opens a sheet of
// its own (a box of tenths, now or from its next month, no recommendation:
// there is none for an average), and Stop, in the goal's menu, with the same
// confirmation as every portal goal's. The sheet is a chunk of its own, fetched
// while its door is on screen; it works from the goal as it opened on it, and
// when it is behind the goal the page reads it again and opens it afresh on the
// latest. The focus goes back to what opened it, or to the page's title.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { PortalGoalSinglePageView } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import type { PortalGoalAverageChangeCommands } from './portal-goal-average-change-sheet'
import { PortalGoalChanges } from './portal-goal-changes'
import { PortalGoalMonthStrip } from './portal-goal-month-strip'
import { PAGE_HEADER_ID, focusPortalGoalPageTitle } from './portal-goal-page'
import { usePortalGoalPageActions } from './portal-goal-page-actions'
import { stripChips } from './portal-goal-page-view'
import {
  averageGoalLine,
  averageTiles,
  goalStateLine,
  singleGoalTitle,
} from './portal-goal-single-page-view'
import type { PortalGoalStopCommands } from './portal-goal-stop-dialog'
import { PortalGoalTiles } from './portal-goal-tiles'

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
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{averageGoalLine(view.subject)}</p>
          {state === null ? null : <p className="text-sm">{state}</p>}
        </div>
        {tiles.length === 0 ? null : <PortalGoalTiles tiles={tiles} label={title} />}
        <PortalGoalMonthStrip chips={stripChips(view.months, view.today)} />
        <PortalGoalChanges
          changes={view.changes}
          personName={props.personName}
          today={view.today}
        />
      </div>
      {dialog}
      {sheet.sheet}
    </PageShell>
  )
}
