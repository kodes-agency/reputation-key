// Property layout — shared shell for property-scoped routes.
// Child routes render via <Outlet />. Navigation is handled by the sidebar.
import {
  createFileRoute,
  Outlet,
  notFound,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { getProperty } from '#/contexts/property/server/properties'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listTeams } from '#/contexts/team/server/teams'
import { ErrorState } from '#/components/layout/page-states'

export const Route = createFileRoute('/_authenticated/properties/$propertyId')({
  beforeLoad: ({ context, params }) => {
    const { role } = context as AuthRouteContext
    // Property admin shell is a manager surface (property.admin).
    // Staff are scoped to /home, /progress, /leaderboard.
    if (!can(role, 'property.admin')) throw redirect({ to: '/home' })
    // Reject non-UUID segments (e.g. stale /properties/import bookmarks) with
    // a clean 404 instead of letting an invalid-uuid query 500.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.propertyId,
      )
    ) {
      throw notFound()
    }
  },
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
      staffCount: staffRes.status === 'fulfilled' ? staffRes.value.assignments.length : 0,
      teamCount: teamsRes.status === 'fulfilled' ? teamsRes.value.teams.length : 0,
    }
  },
  component: PropertyLayout,
})

function PropertyLayout() {
  // propertyId available via Route.useParams() if needed
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isFullHeight = pathname.includes('/reviews')
  const { property } = Route.useLoaderData()

  if (!property) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <ErrorState
          message="Property not found."
          onRetry={() => navigate({ to: '/properties' })}
        />
      </div>
    )
  }

  return (
    <div className={isFullHeight ? 'min-w-0 h-full overflow-hidden' : 'min-w-0 p-6'}>
      <Outlet />
    </div>
  )
}
