// The average private rating goal's page, on `$goalId` (PLAN PG-21): the goal
// page without a bar. Under its title, what the average is (L-6) and its tile:
// this month's governed average against its level ("4.6 so far · goal 4.5"),
// or how many ratings it still needs ("More ratings needed · 6 of 10"), or its
// first month while it waits for it. Its one action is Stop, in the goal's
// menu, with the same confirmation as every portal goal's: it has no number to
// recommend, so no number is changed here.
import type { PortalGoalAverageOfPage } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { PAGE_HEADER_ID, focusPortalGoalPageTitle } from './portal-goal-page'
import { usePortalGoalPageActions } from './portal-goal-page-actions'
import {
  AVERAGE_GOAL_LINE,
  averageTiles,
  singleGoalTitle,
} from './portal-goal-single-page-view'
import type { PortalGoalStopCommands } from './portal-goal-stop-dialog'
import { PortalGoalTiles } from './portal-goal-tiles'

type Props = Readonly<{
  propertyId: string
  propertyName: string
  goal: PortalGoalAverageOfPage
  /** `goal.cancel`: "Stop this goal". */
  canStop: boolean
  stop: PortalGoalStopCommands
}>

export function PortalGoalAveragePage({
  propertyId,
  propertyName,
  goal,
  canStop,
  stop,
}: Props) {
  const title = singleGoalTitle(
    { kind: 'property', key: `property:${propertyId}`, name: propertyName },
    'average',
  )
  const { actions, dialog } = usePortalGoalPageActions({
    goal: { ...goal, measure: null },
    name: title,
    kind: 'single',
    propertyId,
    canChange: false,
    canStop,
    stop,
    focusTitle: focusPortalGoalPageTitle,
  })
  const tiles = averageTiles(goal)
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
        <p className="text-sm text-muted-foreground">{AVERAGE_GOAL_LINE}</p>
        {tiles.length === 0 ? null : <PortalGoalTiles tiles={tiles} label={title} />}
      </div>
      {dialog}
    </PageShell>
  )
}
