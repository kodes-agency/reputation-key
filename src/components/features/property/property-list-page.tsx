// Property list page — extracted from route for testability and separation of concerns
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { partitionWorkspaceProperties } from './property-workspace'

interface Property {
  id: string
  name: string
  slug: string
  timezone: string
  lifecycleState: string
}

export interface PropertyListPageProps {
  properties: ReadonlyArray<Property>
}

function PropertyRow({
  property,
  removed,
}: Readonly<{ property: Property; removed: boolean }>) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border">
      <Link
        to="/properties/$propertyId"
        params={{ propertyId: property.id }}
        className="flex min-w-0 flex-1 items-center justify-between p-4 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-semibold">{property.name}</p>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="secondary">{property.slug}</Badge>
            {removed ? <Badge variant="outline">Removed</Badge> : null}
            <span className="truncate text-sm text-muted-foreground">
              {property.timezone}
            </span>
          </div>
        </div>
        <ChevronRight className="ml-3 size-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  )
}

export function PropertyListPage({ properties }: PropertyListPageProps) {
  const { can } = usePermissions()
  const { workspace, removed } = partitionWorkspaceProperties(properties)

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

      {workspace.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-muted-foreground">
            {removed.length === 0 ? 'No properties yet.' : 'No active properties.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {removed.length === 0
              ? 'Add your first property to get started.'
              : 'Every property you have is currently removed. Restore one to start working again.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workspace.map((property) => (
            <PropertyRow key={property.id} property={property} removed={false} />
          ))}
        </div>
      )}

      {removed.length > 0 ? (
        <details className="mt-8 rounded-lg border border-dashed">
          <summary className="cursor-pointer list-none p-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Removed properties ({removed.length}) — open a property to restore it
          </summary>
          <div className="flex flex-col gap-2 border-t p-4">
            {removed.map((property) => (
              <PropertyRow key={property.id} property={property} removed />
            ))}
          </div>
        </details>
      ) : null}
    </PageShell>
  )
}
