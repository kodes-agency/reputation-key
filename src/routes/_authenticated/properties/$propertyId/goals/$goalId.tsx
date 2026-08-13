import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  changeGovernedGoalStatus,
  getGovernedGoal,
} from '#/contexts/goal/server/governed-goals'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'

const goalDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})
const goalWatermarkFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})
const authRoute = getRouteApi('/_authenticated')
const goalQuery = (propertyId: string, definitionId: string) =>
  queryOptions({
    queryKey: goalKeys.detail(definitionId),
    queryFn: () => getGovernedGoal({ data: { propertyId, definitionId } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/$goalId',
)({
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(goalQuery(params.propertyId, params.goalId)),
  component: GoalDetailRoute,
})

function GoalDetailRoute() {
  const { propertyId, goalId } = Route.useParams()
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalQuery(propertyId, goalId))
  const mutation = useActionMutation(changeGovernedGoalStatus, {
    successMessage: 'Goal status updated',
    invalidateKeys: [goalKeys.all],
  })
  const { definition, version, period, evaluation } = data
  const canManage = can(ctx.role, 'goal.update')
  const updateStatus = (status: 'active' | 'paused' | 'cancelled') =>
    mutation({
      data: {
        propertyId,
        definitionId: goalId,
        status,
        reason: status === 'cancelled' ? 'Cancelled by manager' : `Goal ${status}`,
      },
    })

  return (
    <PageShell>
      <PageHeader
        title={definition.name}
        description={definition.description ?? 'Governed goal definition'}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: definition.name },
        ]}
        actions={
          canManage && definition.status !== 'cancelled' ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() =>
                  updateStatus(definition.status === 'paused' ? 'active' : 'paused')
                }
              >
                {definition.status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => updateStatus('cancelled')}
              >
                Cancel
              </Button>
            </div>
          ) : undefined
        }
      />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Definition</CardTitle>
          <Badge variant="outline">{definition.status}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Scope:</span>{' '}
            {definition.scope.kind.replace('_', ' ')}
          </p>
          <p>
            <span className="text-muted-foreground">Metric:</span>{' '}
            {version.metric.metricKey}
          </p>
          <p>
            <span className="text-muted-foreground">Target:</span> {version.targetValue}
          </p>
          <p>
            <span className="text-muted-foreground">Timezone:</span>{' '}
            {version.propertyTimezone}
          </p>
          <p>
            <span className="text-muted-foreground">Period:</span>{' '}
            {period
              ? `${goalDateFormatter.format(period.periodStart)} – ${goalDateFormatter.format(period.periodEnd)}`
              : 'No open period'}
          </p>
          <p>
            <span className="text-muted-foreground">Freshness:</span>{' '}
            {evaluation
              ? goalWatermarkFormatter.format(evaluation.evaluationWatermark)
              : 'Unavailable'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Evaluation</CardTitle>
        </CardHeader>
        <CardContent>
          {evaluation ? (
            <div className="space-y-2 text-sm">
              <p>State: {evaluation.state.replace('_', ' ')}</p>
              <p>Value: {evaluation.value ?? 'Unavailable'}</p>
              <p>Sample: {evaluation.sampleCount ?? 'Unavailable'}</p>
              {evaluation.reason ? <p>Reason: {evaluation.reason}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Evaluation is unavailable until an eligible governed reading is recorded.
            </p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
