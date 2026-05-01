// Portal detail layout — loads shared data, renders tabs, delegates content to child routes
import {
  createFileRoute,
  getRouteApi,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { getPortal } from '#/contexts/portal/server/portals'
import { hasRole } from '#/shared/domain/roles'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { ArrowLeft, Settings, Link2, Eye } from 'lucide-react'

const portalRouteApi = getRouteApi(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)

export function usePortalLayout() {
  const { portal, propertyId, portalId } = portalRouteApi.useLoaderData()
  const ctx = portalRouteApi.useRouteContext()
  const canEdit = hasRole(ctx.role, 'PropertyManager')
  return { portal, propertyId, portalId, canEdit } as const
}

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  loader: async ({ params }) => {
    const { portal } = await getPortal({
      data: { portalId: params.portalId },
    })
    return {
      portal,
      propertyId: params.propertyId,
      portalId: params.portalId,
    }
  },
  component: PortalLayout,
})

function PortalLayout() {
  const { propertyId, portalId } = Route.useLoaderData()
  const location = useLocation()
  const navigate = useNavigate()

  let activeTab: string = 'settings'
  if (location.pathname.endsWith('/links')) activeTab = 'links'
  else if (location.pathname.endsWith('/preview')) activeTab = 'preview'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" asChild>
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            <ArrowLeft />
            Back
          </Link>
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          const routes: Record<string, string> = {
            settings: '/properties/$propertyId/portals/$portalId',
            links: '/properties/$propertyId/portals/$portalId/links',
            preview: '/properties/$propertyId/portals/$portalId/preview',
          }
          navigate({
            to: routes[tab],
            params: { propertyId, portalId },
          })
        }}
      >
        <TabsList>
          <TabsTrigger value="settings">
            <Settings className="size-3.5" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="links">
            <Link2 className="size-3.5" />
            Links
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="size-3.5" />
            Preview
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  )
}
