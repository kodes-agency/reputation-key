// The plain page of a goal for several subjects, on `$goalId` (PLAN PG-21): a
// goal an older form could make, before goals had pages of their own. Its
// title names whom it counts as its row on the Goals page does ("Reception and
// 2 more · portal goal"); under it, what it counts where, this month as that
// row says it, or a stopped or paused goal's state. Its one action is Stop,
// with the same confirmation as every portal goal's, so a manager can still
// end it: changing it is no longer offered.
import type { PortalGoalSinglePageView } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { PAGE_HEADER_ID, focusPortalGoalPageTitle } from './portal-goal-page'
import { usePortalGoalPageActions } from './portal-goal-page-actions'
import {
  goalStateLine,
  severalGoalWords,
  severalMonthLine,
} from './portal-goal-single-page-view'
import type { PortalGoalStopCommands } from './portal-goal-stop-dialog'

type SeveralView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'several' }>>

type Props = Readonly<{
  propertyId: string
  propertyName: string
  view: SeveralView
  /** `goal.cancel`: "Stop this goal". */
  canStop: boolean
  stop: PortalGoalStopCommands
}>

export function PortalGoalSeveralPage({
  propertyId,
  propertyName,
  view,
  canStop,
  stop,
}: Props) {
  const { goal } = view
  const words = severalGoalWords(goal.metric, view.subjects, propertyName)
  const { actions, dialog } = usePortalGoalPageActions({
    goal: { ...goal, measure: null },
    name: words.title,
    kind: 'single',
    propertyId,
    canChange: false,
    canStop,
    stop,
    focusTitle: focusPortalGoalPageTitle,
  })
  const month = severalMonthLine(goal)
  const state = goalStateLine(goal)
  return (
    <PageShell>
      <div id={PAGE_HEADER_ID}>
        <PageHeader
          title={words.title}
          breadcrumbs={trailCrumbs('goals', { propertyId, propertyName }, words.title)}
          actions={actions}
        />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{words.line}</p>
        {month === null ? null : <p className="text-sm tabular-nums">{month}</p>}
        {state === null ? null : <p className="text-sm">{state}</p>}
      </div>
      {dialog}
    </PageShell>
  )
}
