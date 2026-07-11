// Goals list route — thin wrapper around GoalsListPage component
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listGoals } from '#/contexts/goal/server/goals'
import { GoalsListPage } from '#/components/features/property/goals/goals-list-page'
import {
  goalStatusSchema,
  goalTypeSchema,
} from '#/contexts/goal/application/dto/goal.dto'
import { goalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/shared/queries/route-queries'

const goalsSearchSchema = z.object({
  status: goalStatusSchema.optional(),
  goalType: goalTypeSchema.optional(),
})

type GoalSearchParams = z.infer<typeof goalsSearchSchema>

const goalsQuery = (
  propertyId: string,
  status: GoalSearchParams['status'],
  goalType: GoalSearchParams['goalType'],
) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, status, goalType }),
    queryFn: () => listGoals({ data: { propertyId, status, goalType } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/')({
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
  loader: async ({ params: { propertyId }, deps, context }) => {
    const { status, goalType } = deps as GoalSearchParams
    const { goals } = await context.queryClient.ensureQueryData(
      goalsQuery(propertyId, status, goalType),
    )
    return { goals }
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const search = Route.useSearch() as GoalSearchParams
  const { data: goalsData } = useSuspenseQuery(
    goalsQuery(propertyId, search.status, search.goalType),
  )
  const { goals } = goalsData

  return (
    <GoalsListPage
      goals={goals}
      propertyId={propertyId}
      propertyName={propData.property.name}
    />
  )
}
