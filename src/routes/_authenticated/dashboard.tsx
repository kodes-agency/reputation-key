// Dashboard — smart redirect or property list
// Reads properties from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { deleteProperty } from '#/contexts/property/server/properties'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
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

const authRoute = getRouteApi('/_authenticated')

function DeletePropertyDialog({
  propertyId,
  propertyName,
}: {
  propertyId: string
  propertyName: string
}) {
  const deleteAction = useMutationAction(deleteProperty, {
    successMessage: `"${propertyName}" deleted`,
    invalidateRoutes: ['/_authenticated'],
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete property</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{propertyName}&quot;? This will remove
            all associated reviews, inbox items, and team assignments. This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteAction({ data: { propertyId } })}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const { properties } = authRoute.useLoaderData()
  const navigate = useNavigate()

  useEffect(() => {
    if (properties.length === 1) {
      navigate({
        to: '/properties/$propertyId',
        params: { propertyId: properties[0].id },
        replace: true,
      })
    }
  }, [properties, navigate])

  if (properties.length === 1) {
    return null
  }

  if (properties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h2 className="text-lg font-medium">No properties yet</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Create your first property to start managing reviews, staff performance, and
          reputation.
        </p>
        <Button asChild>
          <Link to="/properties/import">
            <Plus />
            Create Property
          </Link>
        </Button>
      </div>
    )
  }

  // Multiple properties — show list
  const { can } = usePermissions()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Properties</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your organization's properties and locations.
          </p>
        </div>
        {can('property.create') && (
          <Button asChild>
            <Link to="/properties/import">
              <Plus />
              Add Property
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {properties.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent cursor-pointer"
            onClick={() =>
              navigate({
                to: '/properties/$propertyId',
                params: { propertyId: p.id },
              })
            }
          >
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{p.name}</p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{p.slug}</Badge>
                <span className="text-sm text-muted-foreground">{p.timezone}</span>
              </div>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <DeletePropertyDialog propertyId={p.id} propertyName={p.name} />
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
