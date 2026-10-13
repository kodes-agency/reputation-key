// The header row of the Portals tables, the one Property's and the whole
// Organization's: Portal, the five measures (when results are shown to this
// reader), Responsible and the actions. Not shown below a 56 rem container,
// where each row is a card (42 rem in a group's page).
import { ArrowDown, ArrowUp } from 'lucide-react'
import { DataTableHead, DataTableHeader } from '#/components/ui/data-table'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { useOverviewClasses } from './portal-overview-density'
import { MEASURE_COLUMNS } from './portal-overview-measure-cells'
import type { GlossaryTermKey } from '#/shared/dashboard-glossary'
import type { PortalOverviewResultsState } from './portal-overview-results'
import type { SortDirection } from '#/components/ui/list-sort'

function MeasureHeader({
  label,
  order,
  term,
}: Readonly<{
  label: string
  order: SortDirection | undefined
  /** The glossary term that defines the column, where it has one. */
  term?: GlossaryTermKey
}>) {
  const classes = useOverviewClasses()
  const Arrow = order === 'asc' ? ArrowUp : ArrowDown
  return (
    <DataTableHead
      align="end"
      aria-sort={
        order === undefined ? undefined : order === 'asc' ? 'ascending' : 'descending'
      }
      className={classes.measureHead}
    >
      {order === undefined ? null : (
        <Arrow aria-hidden="true" className="mr-1 inline size-3 align-[-1px]" />
      )}
      {term === undefined ? label : <GlossaryTerm term={term}>{label}</GlossaryTerm>}
    </DataTableHead>
  )
}

type Props = Readonly<{
  results: PortalOverviewResultsState
  /** Set while the table is ordered by qualified scans, to mark that column. */
  scansOrder?: SortDirection
}>

export function PortalOverviewTableHead({ results, scansOrder }: Props) {
  return (
    <DataTableHeader>
      <DataTableHead>Portal</DataTableHead>
      {results.status === 'off'
        ? null
        : MEASURE_COLUMNS.map(({ key, label }) => (
            <MeasureHeader
              key={key}
              label={label}
              order={key === 'scans' ? scansOrder : undefined}
              term={key === 'scans' ? 'qualified-scans' : undefined}
            />
          ))}
      <DataTableHead>Responsible</DataTableHead>
      <DataTableHead actions colSpan={2} />
    </DataTableHeader>
  )
}
