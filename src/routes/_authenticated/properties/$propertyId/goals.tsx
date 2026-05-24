// Goals list route — thin wrapper around GoalsListPage component
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listGoals } from '#/contexts/goal/server/goals'
import { GoalsListPage } from '#/components/features/property/goals/goals-list-page'

const goalsSearchSchema = z.object({
  status: z.enum(['active', 'completed', 'expired', 'cancelled']).optional(),
  goalType: z.enum(['open', 'one_shot', 'rolling', 'recurring']).optional(),
})

type GoalSearchParams = z.infer<typeof goalsSearchSchema>

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals')({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
  validateSearch: (search) => goalsSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ params: { propertyId } }) => {
    const { goals } = await listGoals({ data: { propertyId } })
    return { goals }
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { goals } = Route.useLoaderData()
  const { status, goalType } = Route.useSearch() as GoalSearchParams

  return (
    <div className="mx-auto max-w-3xl">
      <GoalsListPage
        goals={goals}
        propertyId={propertyId}
        filters={{ status, goalType }}
      />
    </div>
  )
}
