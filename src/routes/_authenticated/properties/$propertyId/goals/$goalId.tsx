import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  changeGoalProgramAssignments,
  changeGoalProgramStatus,
  getGoalProgram,
  reviseGoalProgram,
} from '#/contexts/reporting/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { StatusBadge } from '#/components/ui/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { GoalProgramRevisionDialog } from '#/components/goals/goal-program-revision-dialog'
import { GoalProgramAssignmentsDialog } from '#/components/goals/goal-program-assignments-dialog'
import { GoalStatusActions } from '#/components/goals/goal-status-actions'
import { GOAL_STATUS, goalResultStatus } from '#/components/goals/goal-status'
import { formatDate } from '#/lib/format'

const authRoute = getRouteApi('/_authenticated')
const goalQuery = (propertyId: string, programId: string) =>
  queryOptions({
    queryKey: goalKeys.detail(propertyId, programId),
    queryFn: () => getGoalProgram({ data: { propertyId, programId } }),
    staleTime: 30_000,
  })
const subjectNamesQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.goalSubjectNames(propertyId),
    queryFn: async () => {
      const [groups, portals] = await Promise.all([
        listPortalGroups({ data: { propertyId } }),
        listPortals({ data: { propertyId } }),
      ])
      return { groups: groups.groups, portals: portals.portals }
    },
  })

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/$goalId',
)({
  staticData: { page: { title: 'Goal', under: 'goals' } },
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw roleUnavailable('Goal', 'properties')
    }
  },
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(goalQuery(params.propertyId, params.goalId)),
      context.queryClient.ensureQueryData(subjectNamesQuery(params.propertyId)),
    ])
  },
  component: GoalDetailRoute,
})

function GoalDetailRoute() {
  const { propertyId, goalId } = Route.useParams()
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalQuery(propertyId, goalId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
  // Pause and Resume act at once, so a refusal (an invalid transition) is a
  // toast. End confirms first, in a dialog that stays open and says a refusal
  // itself, so it is its own mutation with no toast.
  const mutation = useActionMutation(changeGoalProgramStatus, {
    successMessage: 'Goal status updated',
    errorMessage: actionErrorMessage,
    invalidateKeys: [goalKeys.all],
  })
  const endMutation = useActionMutation(changeGoalProgramStatus, {
    successMessage: 'Goal status updated',
    invalidateKeys: [goalKeys.all],
  })
  const { program, version, versions, assignments } = data
  const currentAssignments = assignments.filter(
    (assignment) => assignment.programVersionId === version.id,
  )
  const results = [...data.results].sort(
    (left, right) => right.periodStart.getTime() - left.periodStart.getTime(),
  )
  const canManage = can(ctx.role, 'goal.update')
  // The toast above reports a refusal; settling here keeps it from escaping the
  // click as an unhandled rejection.
  const updateStatus = (status: 'active' | 'paused') => {
    void mutation({
      data: { propertyId, programId: goalId, status, reason: `Goal ${status}` },
    }).catch(() => undefined)
  }
  const endGoal = () =>
    endMutation({
      data: {
        propertyId,
        programId: goalId,
        status: 'ended',
        reason: 'Ended by manager',
      },
    })
  const formatDay = (date: Date): string =>
    formatDate(date, version.propertyTimezone) ?? ''
  const subjectLabel = (subject: GoalSubject) => {
    if (subject.kind === 'property') return propData.property.name
    if (subject.kind === 'portal_group') {
      return (
        subjectNames.groups.find((group) => group.id === subject.portalGroupId)?.name ??
        'Portal group'
      )
    }
    return (
      subjectNames.portals.find((portal) => portal.id === subject.portalId)?.name ??
      'Portal'
    )
  }

  return (
    <PageShell key={`${propertyId}:${goalId}`}>
      <PageHeader
        title={program.name}
        meta={[<StatusBadge key="status" status={program.status} map={GOAL_STATUS} />]}
        description={program.description ?? undefined}
        breadcrumbs={trailCrumbs(
          'goals',
          { propertyId, propertyName: propData.property.name },
          program.name,
        )}
        actions={
          canManage && program.status !== 'ended' ? (
            <div className="flex gap-2">
              <GoalProgramAssignmentsDialog
                changeAssignmentsFn={changeGoalProgramAssignments}
                property={{ id: propertyId, name: propData.property.name }}
                programId={program.id}
                currentVersion={version.version}
                propertyTimezone={version.propertyTimezone}
                assignments={currentAssignments}
                groups={subjectNames.groups}
                portals={subjectNames.portals}
              />
              <GoalProgramRevisionDialog
                reviseGoalProgramFn={reviseGoalProgram}
                property={{ id: propertyId, name: propData.property.name }}
                programId={program.id}
                metric={version.metric}
                targetValue={version.targetValue}
                assignments={currentAssignments}
                groups={subjectNames.groups}
                portals={subjectNames.portals}
              />
              <GoalStatusActions
                goalName={program.name}
                status={program.status}
                pending={mutation.isPending || endMutation.isPending}
                onChange={updateStatus}
                onEnd={endGoal}
              />
            </div>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Program</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Metric:</span>{' '}
            {metricLabel(version.metric)}
          </p>
          <p>
            <span className="text-muted-foreground">Target:</span> {version.targetValue}
          </p>
          <p>
            <span className="text-muted-foreground">Subjects:</span>{' '}
            {currentAssignments.length}
          </p>
          <p>
            <span className="text-muted-foreground">Timezone:</span>{' '}
            {version.propertyTimezone}
          </p>
          <p>
            <span className="text-muted-foreground">Effective from:</span>{' '}
            {formatDay(version.effectiveFrom)}
          </p>
          <p>
            <span className="text-muted-foreground">Version:</span> {version.version}
          </p>
          {program.statusReason ? (
            <p className="md:col-span-2">
              <span className="text-muted-foreground">Status note:</span>{' '}
              {statusReasonLabel(program.statusReason)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Monthly results</CardTitle>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Results will begin with the first full month after the metric source is
              ready.
            </p>
          ) : (
            <div className="divide-y">
              {results.map((result) => {
                const assignment = assignments.find(
                  (candidate) => candidate.id === result.assignmentId,
                )
                const resultVersion = versions.find(
                  (candidate) => candidate.id === result.programVersionId,
                )
                return (
                  <div
                    key={result.id}
                    className="grid gap-2 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {assignment ? subjectLabel(assignment.subject) : 'Subject'}
                      </p>
                      <p className="text-muted-foreground">
                        {formatDay(result.periodStart)} –{' '}
                        {formatDay(new Date(result.periodEnd.getTime() - 1))}
                      </p>
                    </div>
                    <p>
                      {result.evaluation.value ?? '—'} /{' '}
                      {resultVersion?.targetValue ?? '—'}
                    </p>
                    <StatusBadge
                      {...goalResultStatus(result.evaluation, Boolean(result.revision))}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}

function metricLabel(metric: string) {
  switch (metric) {
    case 'qualified_scans':
      return 'Qualified scans'
    case 'portal_rating_count':
      return 'Private rating count'
    case 'portal_rating_average':
      return 'Private rating average'
    default:
      return metric
  }
}

function statusReasonLabel(reason: string) {
  if (reason === 'metric_source_not_active') return 'Waiting for the metric source'
  if (reason === 'awaiting_first_full_month') return 'Starts with the next full month'
  return reason.replaceAll('_', ' ')
}
