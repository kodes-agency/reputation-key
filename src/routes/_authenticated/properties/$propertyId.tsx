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
    // Staff User login is inactive in beta; this remains a manager-only shell.
    if (!can(role, 'property.admin')) throw redirect({ to: '/dashboard' })
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
    // Property detail is cached via Query (propertyQuery); Staff participation
    // is fetched by the People child route via useSuspenseQuery.
    await context.queryClient.ensureQueryData(propertyQuery(propertyId))
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
      {/*
        TanStack Router can retain the same file-route component when only the
        dynamic Property parameter changes. Remount the complete child surface
        so an open dialog, unsaved draft, or component-local workflow can never
        cross from one Property into another.
      */}
      <Outlet key={propertyId} />
    </div>
  )
}
