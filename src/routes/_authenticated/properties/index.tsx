// Property list — shows all properties for the active organization
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { listProperties } from '#/contexts/property/server/properties'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { Badge } from '#/components/ui/badge'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AlertCircle, Plus, ChevronRight } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/properties/')({
  component: PropertyListPage,
})

function PropertyListPage() {
  const ctx = Route.useRouteContext()
  const role = (ctx as { role?: Role }).role ?? 'Staff'
  const canCreate = can(role, 'property.create')

  const query = useQuery({
    queryKey: ['properties'],
    queryFn: () => listProperties(),
  })

  const properties = query.data?.properties ?? []

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
          {query.isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : query.error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>Failed to load properties.</AlertDescription>
            </Alert>
          ) : properties.length === 0 ? (
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
