// Property list page — extracted from route for testability and separation of concerns
import { Link, useNavigate } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight } from 'lucide-react'
import { DeletePropertyDialog } from './delete-property-dialog'
import type { Action } from '#/components/hooks/use-action'
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
  deleteAction: Action<
    { data: { propertyId: string } },
    { deleted: boolean; propertyId: string }
  >
}

export function PropertyListPage({ properties, deleteAction }: PropertyListPageProps) {
  const { can } = usePermissions()
  const navigate = useNavigate()

  return (
    <PageShell>
      <PageHeader
        title="Properties"
        description="Manage your organization's properties and locations."
        breadcrumbs={[{ label: 'Properties' }]}
        actions={
          can('property.create') ? (
            <Button asChild>
              <Link to="/properties/import">
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
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <DeletePropertyDialog
                  propertyId={p.id}
                  propertyName={p.name}
                  deleteAction={deleteAction}
                />
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
