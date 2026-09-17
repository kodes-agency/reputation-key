// Removed properties, on their own tab (docs/plan/property-list-table.md row 16).
// A removed property keeps its page, so its name still opens it; restoring
// happens in its danger zone, where the responsible-manager rule is checked.
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Badge } from '#/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { propertyLifecycleLabel, propertyRestoreWindow } from './property-lifecycle-model'
import {
  buildPropertyListRows,
  sortPropertyListRows,
  type PropertyListProperty,
} from './property-list-view'

const CELL = 'p-0 @3xl:table-cell @3xl:px-4 @3xl:py-3'

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
          className="font-medium underline-offset-4 hover:underline"
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
    <div className="overflow-hidden rounded-lg border bg-card @container">
      <Table aria-label="Removed properties" className="block @3xl:table">
        <TableHeader className="hidden @3xl:table-header-group">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 px-4 text-xs text-muted-foreground">
              Property
            </TableHead>
            <TableHead className="h-10 w-40 px-4 text-xs text-muted-foreground">
              State
            </TableHead>
            <TableHead className="h-10 w-80 px-4 text-xs text-muted-foreground">
              Restore
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="block @3xl:table-row-group">
          {rows.map(({ property, country }) => (
            <TableRow
              key={property.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3.5 @3xl:table-row @3xl:p-0"
            >
              <TableCell className={`${CELL} min-w-0 whitespace-normal`}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    to="/properties/$propertyId"
                    params={{ propertyId: property.id }}
                    className="truncate font-medium underline-offset-4 hover:underline"
                  >
                    {property.name}
                  </Link>
                  {country ? (
                    <span className="text-xs text-muted-foreground">{country}</span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className={`${CELL} col-start-2 row-start-1`}>
                <Badge variant="outline">
                  {propertyLifecycleLabel(property.lifecycleState)}
                </Badge>
              </TableCell>
              <TableCell className={`${CELL} col-span-2 whitespace-normal`}>
                <RestoreCell property={property} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
