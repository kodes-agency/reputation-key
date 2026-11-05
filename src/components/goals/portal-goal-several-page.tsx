// Several-subject goals retain their page and history, with Stop as their only action.

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
