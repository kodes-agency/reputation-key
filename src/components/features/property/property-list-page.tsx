// Property list page — extracted from route for testability and separation of concerns
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

interface Property {
  id: string
  name: string
  slug: string
  timezone: string
}

export interface PropertyListPageProps {
  properties: ReadonlyArray<Property>
}

export function PropertyListPage({ properties }: PropertyListPageProps) {
  const { can } = usePermissions()

  return (
    <PageShell>
      <PageHeader
        title="Properties"
        description="Manage your organization's properties and locations."
        breadcrumbs={[{ label: 'Properties' }]}
        actions={
          can('property.import_gbp_v2') ? (
            <Button asChild>
              <Link to="/properties/import-google">
                <Plus />
                Import Properties
              </Link>
            </Button>
          ) : undefined
        }
      />

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
            <div
              key={p.id}
              className="flex items-stretch overflow-hidden rounded-lg border"
            >
              <Link
                to="/properties/$propertyId"
                params={{ propertyId: p.id }}
                className="flex min-w-0 flex-1 items-center justify-between p-4 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="secondary">{p.slug}</Badge>
                    <span className="truncate text-sm text-muted-foreground">
                      {p.timezone}
                    </span>
                  </div>
                </div>
                <ChevronRight className="ml-3 size-4 shrink-0 text-muted-foreground" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
