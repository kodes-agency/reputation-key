// Goals list route — thin wrapper around GoalsListPage component
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listGoals } from '#/contexts/goal/server/goals'
import { GoalsListPage } from '#/components/features/property/goals/goals-list-page'
import { PageShell } from '#/components/layout/page-shell'
import {
  goalStatusSchema,
  goalTypeSchema,
} from '#/contexts/goal/application/dto/goal.dto'

const goalsSearchSchema = z.object({
  status: goalStatusSchema.optional(),
  goalType: goalTypeSchema.optional(),
})

type GoalSearchParams = z.infer<typeof goalsSearchSchema>

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/',
)({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
  validateSearch: (search) => goalsSearchSchema.parse(search),
  staleTime: 30_000,
  loaderDeps: ({ search }) => {
    const s = search as GoalSearchParams
    return { status: s.status, goalType: s.goalType }
  },
  loader: async ({ params: { propertyId }, deps }) => {
    const { status, goalType } = deps as GoalSearchParams
    const { goals } = await listGoals({ data: { propertyId, status, goalType } })
    return { goals }
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { goals } = Route.useLoaderData()

  return (
    <PageShell>
      <GoalsListPage goals={goals} propertyId={propertyId} />
    </PageShell>
  )
}
