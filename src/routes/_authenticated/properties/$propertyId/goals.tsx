// Goals list route — thin wrapper around GoalsListPage component
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { listGoals } from '#/contexts/goal/server/goals'
import { GoalsListPage } from '#/components/features/property/goals/goals-list-page'

const goalsSearchSchema = z.object({
  status: z.enum(['active', 'completed', 'expired', 'cancelled']).optional(),
  goalType: z.enum(['open', 'one_shot', 'rolling', 'recurring']).optional(),
})

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals')({
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
  const { status, goalType } = Route.useSearch()

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
