// The header row of the Portals tables, the one Property's and the whole
// Organization's: Portal, the five measures (when results are shown to this
// reader), Responsible and the actions. Not shown below a 56 rem container,
// where each row is a card (42 rem in a group's page).
import { ArrowDown, ArrowUp } from 'lucide-react'
import { TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { useOverviewClasses } from './portal-overview-density'
import { MEASURE_COLUMNS } from './portal-overview-measure-cells'
import type { PortalOverviewResultsState } from './portal-overview-results'
import type { SortDirection } from './portal-overview-search-schema'

function MeasureHeader({
  label,
  order,
}: Readonly<{ label: string; order: SortDirection | undefined }>) {
  const classes = useOverviewClasses()
  const Arrow = order === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead
      scope="col"
      aria-sort={
        order === undefined ? undefined : order === 'asc' ? 'ascending' : 'descending'
      }
      className={classes.measureHead}
    >
      {order === undefined ? null : (
        <Arrow aria-hidden="true" className="mr-1 inline size-3 align-[-1px]" />
      )}
      {label}
    </TableHead>
  )
}

type Props = Readonly<{
  results: PortalOverviewResultsState
  /** Set while the table is ordered by qualified scans, to mark that column. */
  scansOrder?: SortDirection
}>

export function PortalOverviewTableHead({ results, scansOrder }: Props) {
  const classes = useOverviewClasses()
  return (
    <TableHeader className={classes.header}>
      <TableRow className="hover:bg-transparent">
        <TableHead scope="col" className="h-10 px-4 text-xs text-muted-foreground">
          Portal
        </TableHead>
        {results.status === 'off'
          ? null
          : MEASURE_COLUMNS.map(({ key, label }) => (
              <MeasureHeader
                key={key}
                label={label}
                order={key === 'scans' ? scansOrder : undefined}
              />
            ))}
        <TableHead scope="col" className="h-10 px-4 text-xs text-muted-foreground">
          Responsible
        </TableHead>
        <TableHead scope="col" colSpan={2} className="h-10 px-2">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  )
}
