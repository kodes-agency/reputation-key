// Portal list — shows all portals for a property
import { createFileRoute, Link } from '@tanstack/react-router'
import { listPortals, deletePortal } from '#/contexts/portal/server/portals'
import { hasRole } from '#/shared/domain/roles'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Plus, Globe, Trash2 } from 'lucide-react'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import { useState } from 'react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  staleTime: 30_000,
  loader: async ({ params }) => {
    const { portals } = await listPortals({
      data: { propertyId: params.propertyId },
    })
    return { portals, propertyId: params.propertyId }
  },
  component: PortalListPage,
})

function PortalListPage() {
  const ctx = Route.useRouteContext()
  const role = ctx.role
  const canCreate = hasRole(role, 'PropertyManager')
  const canDelete = hasRole(role, 'PropertyManager')
  const { propertyId } = Route.useParams()
  const { portals: initialPortals } = Route.useLoaderData()
  const [portals, setPortals] = useState(initialPortals)

  const deleteMutation = useMutationActionSilent(deletePortal)

  const handleDelete = async (portalId: string) => {
    await deleteMutation({ data: { portalId } })
    setPortals((prev) => prev.filter((p) => p.id !== portalId))
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage guest-facing portal pages for this property.
          </p>
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

      {portals.length === 0 ? (
        <EmptyState icon={Globe} title="No portals yet">
          <p className="text-sm text-muted-foreground">
            Create a portal to set up a guest-facing page with links.
          </p>
          {canCreate && (
            <Button asChild>
              <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
                <Plus />
                Add Portal
              </Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              {canDelete && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {portals.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    to="/properties/$propertyId/portals/$portalId"
                    params={{ propertyId, portalId: p.id }}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {p.slug}
                </TableCell>
                <TableCell>
                  {p.isActive ? (
                    <Badge>Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
                {canDelete && (
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This portal and all its links will be permanently removed.
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(p.id)}
                            disabled={deleteMutation.isPending}
                            className="bg-destructive text-white hover:bg-destructive/90"
                          >
                            {deleteMutation.isPending ? 'Deleting...' : 'Delete portal'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
