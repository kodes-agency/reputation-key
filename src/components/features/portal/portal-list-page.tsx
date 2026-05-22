// Portal list page — extracted from route for testability and separation of concerns
import { Link } from '@tanstack/react-router'
import { deletePortal } from '#/contexts/portal/server/portals'
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
import { Plus, Globe, Trash2, Eye } from 'lucide-react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { CopyButton } from '#/components/ui/copy-button'

interface Portal {
  id: string
  name: string
  slug: string
  isActive: boolean
  theme: Record<string, unknown>
}

export interface PortalListPageProps {
  portals: readonly Portal[]
  propertyId: string
  propertySlug: string
}

export function PortalListPage({ portals, propertyId, propertySlug }: PortalListPageProps) {
  const { can } = usePermissions()

  const deleteMutation = useMutationAction(deletePortal, {
    successMessage: 'Portal deleted',
    invalidateRoutes: ['/_authenticated/properties/$propertyId/portals/'],
  })

  return (
    <div className="mx-auto max-w-4xl space-y-8">
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
