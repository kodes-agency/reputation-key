// Property list — shows all properties for the active organization
// Reads from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight } from 'lucide-react'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/properties/')({
  component: PropertyListPage,
})

function PropertyListPage() {
  const { can } = usePermissions()
  const { properties } = authRoute.useLoaderData()

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
            <Link to="/properties/new">
              <Plus />
              Add Property
            </Link>
          </Button>
        )}
      </div>

      {properties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-muted-foreground">No properties yet.</p>
          <p className="text-sm text-muted-foreground">
            Add your first property to get started.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {properties.map((p) => (
            <Link
              key={p.id}
              to="/properties/$propertyId"
              params={{ propertyId: p.id }}
              className="block rounded-lg border p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">{p.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{p.slug}</Badge>
                    <span className="text-sm text-muted-foreground">{p.timezone}</span>
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
