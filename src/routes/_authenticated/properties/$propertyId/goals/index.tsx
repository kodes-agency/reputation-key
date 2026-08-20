import { createFileRoute, getRouteApi, Link, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { Plus, Target } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listGovernedGoals } from '#/contexts/goal/server/governed-goals'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'

const authRoute = getRouteApi('/_authenticated')
const goalsSearchSchema = z.object({
  view: z.enum(['active', 'history']).default('active'),
})
const goalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: ['goals', 'governed', propertyId] as const,
    queryFn: () => listGovernedGoals({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/')({
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
  validateSearch: goalsSearchSchema,
  loader: async ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(goalsQuery(propertyId)),
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { view } = Route.useSearch()
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const goals = data.goals.filter((goal) =>
    view === 'active' ? goal.status !== 'cancelled' : goal.status === 'cancelled',
  )

  return (
    <PageShell>
      <PageHeader
        title="Goals"
        description="Governed property and portal-group targets."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals' },
        ]}
        actions={
          can(ctx.role, 'goal.create') ? (
            <Button asChild>
              <Link to="/properties/$propertyId/goals/new" params={{ propertyId }}>
                <Plus data-icon="inline-start" /> New Goal
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex gap-2" aria-label="Goal views">
        <Button variant={view === 'active' ? 'default' : 'outline'} asChild>
          <Link
            to="/properties/$propertyId/goals"
            params={{ propertyId }}
            search={{ view: 'active' }}
          >
            Active
          </Link>
        </Button>
        <Button variant={view === 'history' ? 'default' : 'outline'} asChild>
          <Link
            to="/properties/$propertyId/goals"
            params={{ propertyId }}
            search={{ view: 'history' }}
          >
            History
          </Link>
        </Button>
      </div>
      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title={view === 'active' ? 'No active goals' : 'No goal history'}
        />
      ) : (
        <div className="grid gap-3">
          {goals.map((goal) => (
            <Card key={goal.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <Link
                    className="font-medium hover:underline"
                    to="/properties/$propertyId/goals/$goalId"
                    params={{ propertyId, goalId: goal.id }}
                  >
                    {goal.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {goal.scope.kind === 'property'
                      ? 'Property goal'
                      : 'Portal group goal'}
                  </p>
                </div>
                <Badge variant="outline">{goal.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  )
}
