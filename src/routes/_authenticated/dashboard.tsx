// Dashboard — smart redirect or property list
// Reads properties from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { usePermissions } from '#/shared/hooks/usePermissions'

const authRoute = getRouteApi('/_authenticated')

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
          <Link to="/properties/new">
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
            <Link to="/properties/new">
              <Plus />
              Add Property
            </Link>
          </Button>
        )}
      </div>

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
    </div>
  )
}
