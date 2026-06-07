import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod/v4'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { useStaffPropertyId } from '#/components/hooks/use-staff-property-id'
import { StaffGoalList } from '#/components/features/staff/staff-goal-list'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import type { StaffGoalEntry } from '#/contexts/goal/server/staff-goals'

const progressSearch = z.object({
  propertyId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/progress')({
  validateSearch: progressSearch,
  loaderDeps: ({ search }) => ({ propertyId: search.propertyId }),
  loader: async ({ deps: { propertyId } }) => {
    if (!propertyId) {
      return { goals: [] as StaffGoalEntry[] }
    }

    const { goals } = await listStaffGoals({ data: { propertyId } })
    return { goals }
  },
  component: StaffProgressPage,
})

function StaffProgressPage() {
  const { goals } = Route.useLoaderData()
  const { propertyId: searchPropertyId } = Route.useSearch()
  const navigate = useNavigate()
  const localPropertyId = useStaffPropertyId()

  // Sync localStorage propertyId to URL search params
  useEffect(() => {
    if (localPropertyId && localPropertyId !== searchPropertyId) {
      navigate({
        to: '/progress',
        search: { propertyId: localPropertyId },
        replace: true,
      })
    }
  }, [localPropertyId, searchPropertyId, navigate])

  // No property selected at all — show empty state
  if (!localPropertyId) {
    return (
      <PageShell>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where you are and where you're going.
          </p>
        </div>
        <StaffEmptyState />
      </PageShell>
    )
  }

  // localStorage has a property but URL isn't synced yet — don't flash empty
  if (localPropertyId && !searchPropertyId) {
    return null
  }

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where you are and where you're going.
        </p>
      </div>
      <StaffGoalList goals={goals} />
    </PageShell>
  )
}
