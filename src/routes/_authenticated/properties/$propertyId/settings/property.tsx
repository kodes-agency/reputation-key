// Property settings — view and edit property details with danger zone
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { deleteProperty, updateProperty } from '#/contexts/property/server/properties'
import { PropertyDetailFields } from '#/components/features/property/PropertyDetailFields'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { useServerFn } from '@tanstack/react-start'
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
import { Button } from '#/components/ui/button'
import { Trash2 } from 'lucide-react'

const parentRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/property',
)({
  component: PropertySettingsPage,
})

function PropertySettingsPage() {
  const { property } = parentRoute.useLoaderData()
  const deleteMutation = useMutationAction(deleteProperty, {
    successMessage: 'Property deleted',
    navigateTo: '/properties',
  })

  const updatePropertyFn = useServerFn(updateProperty)

  if (!property) return null

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Property Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage details for {property.name}.
        </p>
      </div>

      <PropertyDetailFields property={property} updateProperty={updatePropertyFn} />

      <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
        <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
        <p className="text-sm text-muted-foreground">
          This property will be hidden from your organization. Its data will be preserved
          but it will no longer appear in searches or reports.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive hover:text-destructive">
              <Trash2 className="size-3.5" />
              Delete Property
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Property</AlertDialogTitle>
              <AlertDialogDescription>
                This will hide {property.name} from your organization. Its data will be
                preserved but it will no longer appear in searches or reports.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteMutation({ data: { propertyId: property.id } })}
                disabled={deleteMutation.isPending}
              >
                Delete Property
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
