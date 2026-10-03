// Property layout — shared shell for property-scoped routes.
// Child routes render via <Outlet />. Navigation is handled by the sidebar.
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import {
  PROPERTY_NOT_FOUND,
  roleUnavailable,
  routeNotice,
} from '#/shared/auth/route-notice'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useSuspenseQuery } from '@tanstack/react-query'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { isFullBleedRoute } from '#/components/layout/full-bleed-route'

export const Route = createFileRoute('/_authenticated/properties/$propertyId')({
  beforeLoad: ({ context, params }) => {
    const { role } = context as AuthRouteContext
    // Property admin shell is a manager surface (property.admin).
    // Member login is inactive in beta; this remains a manager-only shell.
    if (!can(role, 'property.admin')) throw roleUnavailable('Properties', 'profile')
    // Reject non-UUID segments (e.g. stale /properties/import bookmarks) with
    // a clean 404 instead of letting an invalid-uuid query 500.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.propertyId,
      )
    ) {
      throw routeNotice(PROPERTY_NOT_FOUND)
    }
  },
  staleTime: 60_000,
  loader: async ({ context, params: { propertyId } }) => {
    // Property detail is cached via Query (propertyQuery); Staff participation
    // is fetched by the People child route via useSuspenseQuery.
    try {
      await context.queryClient.ensureQueryData(propertyQuery(propertyId))
    } catch (error) {
      // A property outside the caller's organization answers 404 from the
      // server fn; that is this route's not-found, never a rendered error.
      // Narrow on `.status`: the server function error crosses the wire with it.
      if (isNotFoundStatus(error)) throw routeNotice(PROPERTY_NOT_FOUND)
      throw error
    }
  },
  component: PropertyLayout,
})

function isNotFoundStatus(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 404
  )
}

/**
 * The shell of every Property route. It adds no padding: `<main>` in the
 * authenticated layout is the one gutter owner, so a Property page sits on the
 * same edge as the Properties list and Settings. A full-bleed child (Reviews,
 * the portal workspace) gets the whole height instead.
 *
 * This is also the one place a missing Property is answered. The loader turns a
 * 404 into the Property-not-found notice (`route-notice`), so the branch below is
 * a guard, not a state a child page repeats: every child receives a Property
 * that exists.
 */
function PropertyLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isFullHeight = isFullBleedRoute(pathname)
  const { propertyId } = Route.useParams()
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const property = data.property

  if (!property) throw routeNotice(PROPERTY_NOT_FOUND)

  return (
    <div className={isFullHeight ? 'min-w-0 h-full overflow-hidden' : 'min-w-0'}>
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
