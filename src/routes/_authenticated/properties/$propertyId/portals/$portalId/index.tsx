// Portal editor — main tab with basic info + theme + smart routing

import { createFileRoute, Link } from '@tanstack/react-router'
import { getPortal, updatePortal } from '#/contexts/portal/server/portals'
import { EditPortalForm } from '#/components/features/portal/EditPortalForm'
import { PortalTabNav } from '#/components/features/portal/PortalTabNav'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/',
)({
  loader: async ({ params }) => {
    const { portal } = await getPortal({ data: { portalId: params.portalId } })
    return { portal, propertyId: params.propertyId, portalId: params.portalId }
  },
  component: PortalEditorPage,
})

function PortalEditorPage() {
  const ctx = Route.useRouteContext() as AuthRouteContext
  const { portal, propertyId, portalId } = Route.useLoaderData()
  const canEdit = can(ctx.role, 'portal.update')

  const mutation = useMutationAction(updatePortal, {
    successMessage: 'Portal updated',
  })

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" asChild>
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            <ArrowLeft />
            Back
          </Link>
        </Button>
      </div>

      <PortalTabNav propertyId={propertyId} portalId={portalId} activeTab="settings" />

      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Portal Settings</CardTitle>
          <CardDescription>
            Configure your portal&apos;s basic info, theme, and routing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditPortalForm portal={portal} mutation={mutation} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  )
}
