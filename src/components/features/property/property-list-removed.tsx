// Removed properties, on their own tab (docs/plan/property-list-table.md row 16).
// A removed property keeps its page, so its name still opens it; restoring
// happens in its danger zone, where the responsible-manager rule is checked.
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { StatusBadge } from '#/components/ui/status-badge'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import {
  PROPERTY_LIFECYCLE_STATUS,
  propertyRestoreWindow,
} from './property-lifecycle-model'
import {
  buildPropertyListRows,
  sortPropertyListRows,
  type PropertyListProperty,
} from './property-list-view'

function RestoreCell({ property }: Readonly<{ property: PropertyListProperty }>) {
  const { can } = usePermissions()
  const restore = propertyRestoreWindow(
    {
      lifecycleState: property.lifecycleState,
      purgeScheduledFor: property.purgeScheduledFor ?? null,
    },
    new Date(),
  )
  if (restore.kind === 'none') return null
  if (restore.kind === 'support') {
    return <span className="text-muted-foreground">Ask support to restore</span>
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-muted-foreground">Restore before {restore.deadline}</span>
      {can('property.restore') ? (
        <Link
          to="/properties/$propertyId/settings/danger"
          params={{ propertyId: property.id }}
          aria-label={`Restore ${property.name}`}
          className={ROW_NAME_LINK}
        >
          Restore…
        </Link>
      ) : null}
    </span>
  )
}

export function PropertyListRemoved({
  properties,
}: Readonly<{ properties: ReadonlyArray<PropertyListProperty> }>) {
  const rows = sortPropertyListRows(
    buildPropertyListRows(properties, undefined, undefined),
    'name',
    'asc',
  )
  return (
    <DataTable label="Removed properties" from="3xl">
      <DataTableHeader>
        <DataTableHead>Property</DataTableHead>
        <DataTableHead className="w-40">State</DataTableHead>
        <DataTableHead className="w-80">Restore</DataTableHead>
      </DataTableHeader>
      <DataTableBody>
        {rows.map(({ property, country }) => (
          <DataTableRow key={property.id}>
            <DataTableCell className="min-w-0 whitespace-normal">
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  to="/properties/$propertyId"
                  params={{ propertyId: property.id }}
                  className={cn('truncate font-medium', ROW_NAME_LINK)}
                >
                  {property.name}
                </Link>
                {country ? (
                  <span className="text-xs text-muted-foreground">{country}</span>
                ) : null}
              </span>
            </DataTableCell>
            <DataTableCell className="col-start-2 row-start-1">
              <StatusBadge
                status={property.lifecycleState}
                map={PROPERTY_LIFECYCLE_STATUS}
              />
            </DataTableCell>
            <DataTableCell className="col-span-2 whitespace-normal">
              <RestoreCell property={property} />
            </DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  )
}
