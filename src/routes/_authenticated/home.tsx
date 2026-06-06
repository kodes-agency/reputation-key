import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod/v4'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { getStaffDashboardDataFn } from '#/contexts/dashboard/server/staff-dashboard'
import { useStaffPropertyId } from '#/components/hooks/use-staff-property-id'
import { StaffHomeKpis } from '#/components/features/staff/staff-home-kpis'
import { StaffGoalSummary } from '#/components/features/staff/staff-goal-summary'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import type { StaffGoalEntry } from '#/contexts/goal/server/staff-goals'

const homeSearch = z.object({
  propertyId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/home')({
  validateSearch: homeSearch,
  loaderDeps: ({ search }) => ({ propertyId: search.propertyId }),
  loader: async ({ deps: { propertyId } }) => {
    if (!propertyId) {
      return { goals: [] as StaffGoalEntry[], kpis: null as KPIs | null }
    }

    const [{ goals }, dashboard] = await Promise.all([
      listStaffGoals({ data: { propertyId } }),
      getStaffDashboardDataFn({ data: { propertyId, timeRange: '30d' } }),
    ])

    return { goals, kpis: dashboard.kpis }
  },
  component: StaffHomePage,
})

function StaffHomePage() {
  const { goals, kpis } = Route.useLoaderData()
  const { propertyId: searchPropertyId } = Route.useSearch()
  const navigate = useNavigate()
  const localPropertyId = useStaffPropertyId()

  // Sync localStorage propertyId to URL search params
  useEffect(() => {
    if (localPropertyId && localPropertyId !== searchPropertyId) {
      navigate({
        to: '/home',
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
          <h1 className="text-xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your performance at a glance.
          </p>
        </div>
        <StaffEmptyState />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your performance at a glance.
        </p>
      </div>

      {kpis && <StaffHomeKpis kpis={kpis} />}

      <StaffGoalSummary goals={goals} />
    </PageShell>
  )
}
