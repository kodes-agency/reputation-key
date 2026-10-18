// The Portal goal results page, `/goals/portal-results` (ADR 0068 decision 14;
// PLAN PG-18): every month's result of the Portal goals, the matrix the Goals
// page used to carry (its months as sections, newest first), and the Portal
// goals that have ended, each with the day it ended. A part with nothing to
// show is not drawn: the ways here (the Portal goals section's foot and the goal
// page's "All monthly results") appear only once a month has closed or a goal
// has ended.
import { Link } from '@tanstack/react-router'
import type { GoalResultsMatrix as GoalResultsMatrixModel } from '#/contexts/reporting/application/public-api'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import { GoalResultsMatrix } from './goal-results-matrix'
import {
  ENDED_PORTAL_GOALS_ID,
  ENDED_PORTAL_GOALS_TITLE,
  PORTAL_GOAL_RESULTS_TITLE,
  type EndedPortalGoal,
} from './portal-goal-results-view'

type Props = Readonly<{
  propertyId: string
  propertyName: string
  matrix: GoalResultsMatrixModel
  ended: readonly EndedPortalGoal[]
  /** The instant the page was opened, which decides whether a day prints its year. */
  now: Date
  /** Who changed a month's number, by name; null where the directory cannot say. */
  personName: (userId: string) => string | null
}>

/** Where `#ended` lands: below the sticky header, as `#portal-goals` does. */
const ANCHOR_MARGIN = '6rem'

/** The ended Portal goals, the most recently ended first, each opening its goal. */
function EndedPortalGoals({ propertyId, ended }: Pick<Props, 'propertyId' | 'ended'>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle
          as="h2"
          id={ENDED_PORTAL_GOALS_ID}
          style={{ scrollMarginTop: ANCHOR_MARGIN }}
        >
          {ENDED_PORTAL_GOALS_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label={ENDED_PORTAL_GOALS_TITLE} className="flex flex-col gap-4">
          {ended.map((goal) => (
            <li key={goal.programId} className="flex flex-col gap-1">
              <Link
                className={cn('self-start font-medium', ROW_NAME_LINK)}
                to="/properties/$propertyId/goals/$goalId"
                params={{ propertyId, goalId: goal.programId }}
              >
                {goal.name}
              </Link>
              <p className="text-sm text-muted-foreground">{goal.summary}</p>
              <p className="text-sm text-muted-foreground">{goal.ended}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function PortalGoalResults({
  propertyId,
  propertyName,
  matrix,
  ended,
  now,
  personName,
}: Props) {
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title={PORTAL_GOAL_RESULTS_TITLE}
        breadcrumbs={trailCrumbs(
          'goals',
          { propertyId, propertyName },
          PORTAL_GOAL_RESULTS_TITLE,
        )}
      />
      {matrix.months.length === 0 ? null : (
        <GoalResultsMatrix matrix={matrix} now={now} personName={personName} />
      )}
      {ended.length === 0 ? null : (
        <EndedPortalGoals propertyId={propertyId} ended={ended} />
      )}
    </PageShell>
  )
}
