// Property list — shows all properties for the active organization
import { createFileRoute, Link } from '@tanstack/react-router'
import { listProperties } from '#/contexts/property/server/properties'
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
import { Plus, ChevronRight } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/properties/')({
  loader: () => listProperties(),
  component: PropertyListPage,
})

function PropertyListPage() {
  const ctx = Route.useRouteContext() as AuthRouteContext
  const role = ctx.role
  const canCreate = can(role, 'property.create')
  const loaderData = Route.useLoaderData()
  const properties = loaderData.properties ?? []

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-2xl">Properties</CardTitle>
              <CardDescription>
                Manage your organization&apos;s properties and locations.
              </CardDescription>
            </div>
            {canCreate && (
              <Button asChild>
                <Link to="/properties/new">
                  <Plus />
                  Add Property
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {properties.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-muted-foreground">No properties yet.</p>
                <p className="text-sm text-muted-foreground">
                  Add your first property to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
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
                        <span className="text-sm text-muted-foreground">
                          {p.timezone}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
