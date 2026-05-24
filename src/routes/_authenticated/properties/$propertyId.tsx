// Property layout — shared shell for property-scoped routes.
// Child routes render via <Outlet />. Navigation is handled by the sidebar.
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { getProperty } from '#/contexts/property/server/properties'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listTeams } from '#/contexts/team/server/teams'
import { Button } from '#/components/ui/button'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AlertCircle } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId')({
  staleTime: 60_000,
  loader: async ({ params: { propertyId } }) => {
    // Use allSettled so a transient DB error in staff/teams doesn't crash the page.
    // Property data is critical; staff/teams are sidebar metadata.
    const [propertyRes, staffRes, teamsRes] = await Promise.allSettled([
      getProperty({ data: { propertyId } }),
      listStaffAssignments({ data: { propertyId } }),
      listTeams({ data: { propertyId } }),
    ])

    if (propertyRes.status === 'rejected') {
      throw propertyRes.reason
    }

    return {
      property: propertyRes.value.property,
      staffCount:
        staffRes.status === 'fulfilled'
          ? staffRes.value.assignments.length
          : 0,
      teamCount:
        teamsRes.status === 'fulfilled' ? teamsRes.value.teams.length : 0,
    }
  },
  component: PropertyLayout,
})

function PropertyLayout() {
  // propertyId available via Route.useParams() if needed
  const navigate = useNavigate()
  const { property } = Route.useLoaderData()

  if (!property) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle />
          <AlertDescription>Property not found.</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate({ to: '/properties' })}>
          Back to Properties
        </Button>
      </div>
    )
  }

  return (
    <div className="min-w-0 p-6">
      <Outlet />
    </div>
  )
}
