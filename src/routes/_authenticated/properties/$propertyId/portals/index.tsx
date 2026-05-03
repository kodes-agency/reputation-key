// Portal list — shows all portals for a property
import { createFileRoute, Link, getRouteApi } from '@tanstack/react-router'
import { listPortals, deletePortal } from '#/contexts/portal/server/portals'
import { usePermissions } from '#/shared/hooks/usePermissions'
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
import { Plus, Globe, Trash2, Copy, Eye } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { getLogger } from '#/shared/observability/logger'

function CopyButton({ text }: { text: string }) {
  const handleCopy = async () => {
    try {
      const fullUrl =
        typeof window !== 'undefined' ? `${window.location.origin}${text}` : text
      await navigator.clipboard.writeText(fullUrl)
    } catch {
      // fallback
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 hover:bg-muted rounded transition-colors"
      title="Copy URL"
    >
      <Copy className="size-3 text-muted-foreground" />
    </button>
  )
}

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  staleTime: 30_000,
  loader: async ({ params }) => {
    try {
      const { portals } = await listPortals({
        data: { propertyId: params.propertyId },
      })
      return {
        portals,
        propertyId: params.propertyId,
      }
    } catch (e) {
      getLogger().error(
        { err: e, propertyId: params.propertyId },
        '[loader] listPortals failed',
      )
      return { portals: [], propertyId: params.propertyId }
    }
  },
  component: PortalListPage,
})

function PortalListPage() {
  const { can } = usePermissions()
  const { propertyId } = Route.useParams()
  const { portals } = Route.useLoaderData()

  // Get property slug from parent layout's loaded properties
  const authRoute = getRouteApi('/_authenticated')
  const { properties } = authRoute.useLoaderData()
  const propertySlug =
    properties?.find((p: { id: string }) => p.id === propertyId)?.slug ?? ''

  const deleteMutation = useMutationAction(deletePortal, {
    successMessage: 'Portal deleted',
  })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage guest-facing portal pages for this property.
          </p>
        </div>
        {can('portal.create') && (
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
          {can('portal.create') && (
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
              <TableHead>Guest URL</TableHead>
              <TableHead>Theme</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portals.map((p) => (
              <TableRow key={p.id} className={p.isActive ? '' : 'opacity-50'}>
                <TableCell>
                  <Link
                    to="/properties/$propertyId/portals/$portalId"
                    params={{ propertyId, portalId: p.id }}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <code className="text-xs text-muted-foreground">
                      /p/{propertySlug}/{p.slug}
                    </code>
                    <CopyButton text={`/p/${propertySlug}/${p.slug}`} />
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    className="size-5 rounded-full border"
                    style={{
                      backgroundColor:
                        (p.theme as Record<string, string>)?.primaryColor ?? '#6366f1',
                    }}
                  />
                </TableCell>
                <TableCell>
                  {p.isActive ? (
                    <Badge>Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        to="/properties/$propertyId/portals/$portalId"
                        params={{ propertyId, portalId: p.id }}
                      >
                        <Eye className="size-3.5" />
                      </Link>
                    </Button>
                    {can('portal.delete') && (
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
                              onClick={() => deleteMutation({ data: { portalId: p.id } })}
                              disabled={deleteMutation.isPending}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              {deleteMutation.isPending ? 'Deleting...' : 'Delete portal'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
