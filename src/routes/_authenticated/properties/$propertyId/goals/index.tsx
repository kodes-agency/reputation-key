// Goals list route — thin wrapper around GoalsListPage component
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
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
import type { GoalListView, HistoryGoalStatus } from '#/contexts/goal/ui/helpers'
import type { GoalType } from '#/contexts/goal/application/public-api'
import { goalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'

const authRoute = getRouteApi('/_authenticated')

const historyStatusSchema = z.enum(['completed', 'expired', 'cancelled'])

const rawGoalsSearchSchema = z.object({
  view: z.enum(['active', 'history']).optional(),
  historyStatus: historyStatusSchema.optional(),
  status: goalStatusSchema.optional(),
  goalType: goalTypeSchema.optional(),
})

type GoalSearchParams = Readonly<{
  view: GoalListView
  historyStatus?: HistoryGoalStatus
  goalType?: GoalType
}>

function normalizeGoalsSearch(search: unknown): GoalSearchParams {
  const parsed = rawGoalsSearchSchema.parse(search)
  const legacyHistoryStatus =
    parsed.status && parsed.status !== 'active' ? parsed.status : undefined
  const view =
    parsed.view ?? (legacyHistoryStatus ? 'history' : ('active' satisfies GoalListView))

  return {
    view,
    historyStatus:
      view === 'history' ? (parsed.historyStatus ?? legacyHistoryStatus) : undefined,
    goalType: parsed.goalType,
  }
}

const goalsQuery = (propertyId: string, goalType: GoalSearchParams['goalType']) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, goalType }),
    queryFn: () => listGoals({ data: { propertyId, goalType } }),
    staleTime: 30_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/')({
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
  validateSearch: normalizeGoalsSearch,
  staleTime: 30_000,
  loaderDeps: ({ search }) => {
    const s = search as GoalSearchParams
    return { goalType: s.goalType }
  },
  loader: async ({ params: { propertyId }, deps, context }) => {
    const { goalType } = deps as GoalSearchParams
    const { goals } = await context.queryClient.ensureQueryData(
      goalsQuery(propertyId, goalType),
    )
    return { goals }
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const search = Route.useSearch() as GoalSearchParams
  const { data: goalsData } = useSuspenseQuery(goalsQuery(propertyId, search.goalType))
  const { goals } = goalsData

  return (
    <GoalsListPage
      goals={goals}
      propertyId={propertyId}
      propertyName={propData.property.name}
      view={search.view}
      historyStatus={search.historyStatus}
      goalType={search.goalType}
      canCreateGoal={can(ctx.role, 'goal.create')}
    />
  )
}
