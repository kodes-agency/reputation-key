import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  changeGoalProgramStatus,
  getGoalProgram,
  reviseGoalProgram,
} from '#/contexts/goal/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import type { GoalSubject } from '#/contexts/goal/application/public-api'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { GoalProgramRevisionDialog } from '#/components/goals/goal-program-revision-dialog'

const authRoute = getRouteApi('/_authenticated')
const goalQuery = (propertyId: string, programId: string) =>
  queryOptions({
    queryKey: goalKeys.detail(programId),
    queryFn: () => getGoalProgram({ data: { propertyId, programId } }),
    staleTime: 30_000,
  })
const subjectNamesQuery = (propertyId: string) =>
  queryOptions({
    queryKey: [...portalKeys.all, 'goal-subject-names', propertyId] as const,
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
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw redirect({ to: '/properties' })
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
  const mutation = useActionMutation(changeGoalProgramStatus, {
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
  const updateStatus = (status: 'active' | 'paused' | 'ended') =>
    mutation({
      data: {
        propertyId,
        programId: goalId,
        status,
        reason: status === 'ended' ? 'Ended by manager' : `Goal ${status}`,
      },
    })
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: version.propertyTimezone,
  })
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
    <PageShell>
      <PageHeader
        title={program.name}
        description={program.description ?? 'Monthly Goal Program'}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: program.name },
        ]}
        actions={
          canManage && program.status !== 'ended' ? (
            <div className="flex gap-2">
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
              {program.status === 'active' || program.status === 'paused' ? (
                <>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() =>
                      updateStatus(program.status === 'paused' ? 'active' : 'paused')
                    }
                  >
                    {program.status === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={mutation.isPending}
                    onClick={() => updateStatus('ended')}
                  >
                    End goal
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  disabled={mutation.isPending}
                  onClick={() => updateStatus('ended')}
                >
                  End goal
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Program</CardTitle>
          <Badge variant="outline">{program.status}</Badge>
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
            {dateFormatter.format(version.effectiveFrom)}
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
          <CardTitle>Monthly results</CardTitle>
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
                        {dateFormatter.format(result.periodStart)} –{' '}
                        {dateFormatter.format(new Date(result.periodEnd.getTime() - 1))}
                      </p>
                    </div>
                    <p>
                      {result.evaluation.value ?? '—'} /{' '}
                      {resultVersion?.targetValue ?? '—'}
                    </p>
                    <Badge variant="outline">
                      {result.evaluation.state === 'eligible'
                        ? result.evaluation.achieved
                          ? 'Achieved'
                          : 'Not achieved'
                        : evaluationLabel(result.evaluation.state)}
                    </Badge>
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

function evaluationLabel(state: string) {
  if (state === 'insufficient_data') return 'More ratings needed'
  if (state === 'updating') return 'Updating'
  if (state === 'quarantined') return 'Needs review'
  return 'Unavailable'
}
