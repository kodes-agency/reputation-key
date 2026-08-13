import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGovernedGoal } from '#/contexts/goal/server/governed-goals'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

const portalGroupsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.groups(propertyId),
    queryFn: () => listPortalGroups({ data: { propertyId } }),
  })

const METRICS = [
  {
    id: METRIC_VERSION_IDS.contentReviewCompleted,
    label: 'Content reviews completed',
    kind: 'progress' as const,
  },
  {
    id: METRIC_VERSION_IDS.configurationCompleteness,
    label: 'Configuration completeness',
    kind: 'level' as const,
  },
  {
    id: METRIC_VERSION_IDS.approvedDestinationRatio,
    label: 'Approved destination ratio',
    kind: 'ratio' as const,
  },
] as const

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  loader: ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(portalGroupsQuery(propertyId)),
  component: CreateGoalPage,
})

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: groupsData } = useSuspenseQuery(portalGroupsQuery(propertyId))
  const navigate = useNavigate()
  const [metricId, setMetricId] = useState<string>(METRICS[0].id)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [portalGroupId, setPortalGroupId] = useState('')
  const mutation = useActionMutation(createGovernedGoal, {
    successMessage: 'Goal created',
    invalidateKeys: [goalKeys.all],
    onSuccess: async ({ definition }) => {
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId: definition.id },
      })
    },
  })
  const selectedMetric = METRICS.find((metric) => metric.id === metricId) ?? METRICS[0]

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetValue = Number(target)
    if (!name.trim() || !Number.isFinite(targetValue) || targetValue <= 0) return
    mutation({
      data: {
        propertyId,
        scope: portalGroupId
          ? { kind: 'portal_group', portalGroupId }
          : { kind: 'property' },
        name,
        metricDefinitionVersionId: selectedMetric.id,
        measureKind: selectedMetric.kind,
        targetValue,
        sourcePolicy: 'first_party_workflow',
        recurrenceRule: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      },
    })
  }

  return (
    <PageShell>
      <PageHeader
        title="New Goal"
        description="Create a governed property or portal-group goal."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: 'New Goal' },
        ]}
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Goal definition</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="goal-name">Name</Label>
              <Input
                id="goal-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-metric">Approved metric</Label>
              <select
                id="goal-metric"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={metricId}
                onChange={(event) => setMetricId(event.target.value)}
              >
                {METRICS.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-scope">Scope</Label>
              <select
                id="goal-scope"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={portalGroupId}
                onChange={(event) => setPortalGroupId(event.target.value)}
              >
                <option value="">Property</option>
                {groupsData.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Individual portal and staff targets are not available.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-target">Target</Label>
              <Input
                id="goal-target"
                type="number"
                min="0.0001"
                step="any"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                required
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Timezone is loaded from {propData.property.name} and snapshotted on the
              version.
            </p>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create goal'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  )
}
