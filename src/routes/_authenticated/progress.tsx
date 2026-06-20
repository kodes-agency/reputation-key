import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { StaffGoalList } from '#/components/features/staff/staff-goal-list'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { StaffGoalEntry } from '#/contexts/goal/application/public-api'

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
  // No property selected — the sidebar defaults ?propertyId= on first load.
  if (!searchPropertyId) {
    return (
      <PageShell>
        <PageHeader
          title="Progress"
          description="Where you are and where you're going."
        />
        <StaffEmptyState />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="Progress" description="Where you are and where you're going." />
      <StaffGoalList goals={goals} />
    </PageShell>
  )
}
