// Portal list — shows all portals for a property

import { createFileRoute, Link } from '@tanstack/react-router'
import { listPortals, deletePortal } from '#/contexts/portal/server/portals'
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
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight, Globe, Trash2 } from 'lucide-react'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import { useState } from 'react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  loader: async ({ params }) => {
    const { portals } = await listPortals({ data: { propertyId: params.propertyId } })
    return { portals, propertyId: params.propertyId }
  },
  component: PortalListPage,
})

function PortalListPage() {
  const ctx = Route.useRouteContext() as AuthRouteContext
  const role = ctx.role
  const canCreate = can(role, 'portal.create')
  const canDelete = can(role, 'portal.delete')
  const { propertyId } = Route.useParams()
  const { portals: initialPortals } = Route.useLoaderData()
  const [portals, setPortals] = useState(initialPortals)

  const deleteMutation = useMutationActionSilent(deletePortal)

  const handleDelete = async (portalId: string) => {
    if (!confirm('Are you sure you want to delete this portal?')) return
    try {
      await deleteMutation({ data: { portalId } })
      setPortals((prev) => prev.filter((p) => p.id !== portalId))
    } catch (err) {
      console.error('Failed to delete portal:', err)
    }
  }

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-2xl">Portals</CardTitle>
              <CardDescription>
                Manage guest-facing portal pages for this property.
              </CardDescription>
            </div>
            {canCreate && (
              <Button asChild>
                <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
                  <Plus />
                  Add Portal
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {portals.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <Globe className="size-8 text-muted-foreground" />
                <p className="text-muted-foreground">No portals yet.</p>
                <p className="text-sm text-muted-foreground">
                  Create a portal to set up a guest-facing page with links.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {portals.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2"
                >
                  <Link
                    to="/properties/$propertyId/portals/$portalId"
                    params={{ propertyId, portalId: p.id }}
                    className="flex-1 block rounded-lg border p-4 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <p className="font-semibold">{p.name}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{p.slug}</Badge>
                          {p.isActive ? (
                            <Badge>Active</Badge>
                          ) : (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </Link>
                  {canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(p.id)}
                      className="shrink-0"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
