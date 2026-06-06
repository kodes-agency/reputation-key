import { createFileRoute } from '@tanstack/react-router'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { StaffGoalsSection } from '#/components/features/property/goals/staff-goals-section'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/home')({
  loader: async () => {
    const { goals } = await listStaffGoals({ data: {} })
    return { goals }
  },
  component: StaffHomePage,
})

function StaffHomePage() {
  const { goals } = Route.useLoaderData()

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your performance at a glance.
        </p>
      </div>
      <StaffGoalsSection goals={goals} />
    </PageShell>
  )
}
