import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoalProgram } from '#/contexts/goal/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  GoalSubjectPicker,
  goalSubjectsFromKeys,
  type GoalSubjectKey,
} from '#/components/goals/goal-subject-picker'

const subjectsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: [...portalKeys.all, 'goal-subjects', propertyId] as const,
    queryFn: async () => {
      const [groups, portals] = await Promise.all([
        listPortalGroups({ data: { propertyId } }),
        listPortals({ data: { propertyId } }),
      ])
      return { groups: groups.groups, portals: portals.portals }
    },
  })

const METRICS = [
  {
    id: 'qualified_scans' as const,
    label: 'Qualified scans',
    description:
      'Counts eligible portal scans. You can configure this now; results remain scheduled until scan attribution is active.',
  },
  {
    id: 'portal_rating_count' as const,
    label: 'Private rating count',
    description: 'Counts private 1–5 star ratings submitted through the review gateway.',
  },
  {
    id: 'portal_rating_average' as const,
    label: 'Private rating average',
    description:
      'Average private star rating. A monthly result needs at least 10 eligible ratings.',
  },
] as const

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.create')) {
      throw redirect({ to: '/properties' })
    }
  },
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(propertyQuery(propertyId)),
      context.queryClient.ensureQueryData(subjectsQuery(propertyId)),
    ])
  },
  component: CreateGoalPage,
})

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: subjects } = useSuspenseQuery(subjectsQuery(propertyId))
  const navigate = useNavigate()
  const [metric, setMetric] =
    useState<(typeof METRICS)[number]['id']>('portal_rating_count')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('')
  const [selected, setSelected] = useState<GoalSubjectKey[]>([])
  const mutation = useActionMutation(createGoalProgram, {
    successMessage: 'Goal created',
    invalidateKeys: [goalKeys.all],
    onSuccess: async ({ program }) => {
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId: program.id },
      })
    },
  })
  const selectedMetric = METRICS.find((candidate) => candidate.id === metric)!
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const targetValue = Number(target)
    if (!name.trim() || !Number.isFinite(targetValue) || selected.length === 0) return
    mutation({
      data: {
        propertyId,
        name,
        description: description.trim() || null,
        metric,
        targetValue,
        subjects: goalSubjectsFromKeys(selected),
      },
    })
  }

  return (
    <PageShell>
      <PageHeader
        title="New Goal"
        description="Set one monthly target for one or more property, portal-group, or portal subjects."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: 'New Goal' },
        ]}
      />
      <form className="grid max-w-5xl gap-4 lg:grid-cols-2" onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>Goal program</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
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
              <Label htmlFor="goal-description">Description (optional)</Label>
              <Textarea
                id="goal-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2_000}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-metric">Metric</Label>
              <select
                id="goal-metric"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={metric}
                onChange={(event) =>
                  setMetric(event.target.value as (typeof METRICS)[number]['id'])
                }
              >
                {METRICS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {selectedMetric.description}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-target">Monthly target</Label>
              <Input
                id="goal-target"
                type="number"
                min="1"
                max={metric === 'portal_rating_average' ? 5 : undefined}
                step={metric === 'portal_rating_average' ? 0.1 : 1}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Changes take effect from the next complete month in{' '}
                {propData.property.name}’s timezone.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subjects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <GoalSubjectPicker
              property={{ id: propertyId, name: propData.property.name }}
              groups={subjects.groups}
              portals={subjects.portals}
              selected={selected}
              onChange={setSelected}
            />
            <Button type="submit" disabled={mutation.isPending || selected.length === 0}>
              {mutation.isPending ? 'Creating…' : 'Create goal'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </PageShell>
  )
}
