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
import { useSuspenseQuery } from '@tanstack/react-query'
import { propertyQuery } from '#/routes/-queries/route-queries'
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
  loader: async ({ context, params: { propertyId } }) => {
    // Property detail is cached via Query (propertyQuery); staff/teams are
    // fetched by their own child routes (people/teams) via useSuspenseQuery.
    const result = await context.queryClient.ensureQueryData(propertyQuery(propertyId))
    return { property: result.property }
  },
  component: PropertyLayout,
})

function PropertyLayout() {
  // propertyId available via Route.useParams() if needed
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isFullHeight = pathname.includes('/reviews')
  const { propertyId } = Route.useParams()
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const property = data.property

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
