// The Properties list as one table (docs/plan/property-list-table.md rows 2–3).
//
// One DOM for every width: a property's name renders once, which the e2e
// journeys and Storybook (no CSS there) both rely on. Below a 56 rem container
// each row stacks as a small grid — name and rating, then reviews, then the
// work and setup lines — and the header row is not shown; from 56 rem it is a
// table with sortable column headers.
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableSortHead,
} from '#/components/ui/data-table'
import { cn } from '#/lib/utils'
import type { PropertyListSort } from './property-list-search-schema'
import {
  AttentionValue,
  PropertyNameCell,
  RatingValue,
  ReviewsValue,
  SetupValue,
} from './property-list-cells'
import { PropertyRowActions } from './property-list-row-actions'
import type { DataState, PropertyListRow, PropertyListView } from './property-list-view'

type Props = Readonly<{
  rows: ReadonlyArray<PropertyListRow>
  view: PropertyListView
  fleet: DataState
  setup: DataState
  onSort: (sort: PropertyListSort) => void
}>

function SortHead({
  column,
  view,
  onSort,
  align,
  className,
  children,
}: Readonly<{
  column: PropertyListSort
  view: PropertyListView
  onSort: (sort: PropertyListSort) => void
  align?: 'start' | 'end'
  className?: string
  children: string
}>) {
  return (
    <DataTableSortHead
      direction={view.sort === column ? view.dir : null}
      onSort={() => onSort(column)}
      align={align}
      className={className}
    >
      {children}
    </DataTableSortHead>
  )
}

export function PropertyListTable({ rows, view, fleet, setup, onSort }: Props) {
  const figures = fleet !== 'unavailable'
  const setupShown = setup !== 'unavailable'
  const head = { view, onSort }

  return (
    <DataTable label="Properties">
      <DataTableHeader>
        <SortHead column="name" {...head}>
          Property
        </SortHead>
        {figures ? (
          <>
            <SortHead column="rating" align="end" className="w-24" {...head}>
              Rating
            </SortHead>
            <SortHead column="reviews" align="end" className="w-24" {...head}>
              Reviews
            </SortHead>
            <SortHead column="attention" className="w-56" {...head}>
              Needs attention
            </SortHead>
          </>
        ) : null}
        {setupShown ? (
          <SortHead column="setup" className="w-52" {...head}>
            Setup
          </SortHead>
        ) : null}
        <DataTableHead actions className="w-14" />
      </DataTableHeader>
      <DataTableBody>
        {rows.map((row) => {
          const { property, comparison } = row
          const clear = comparison !== undefined && comparison.attention.total === 0
          const setUp = row.setup !== undefined && row.setup.nextStep === null
          return (
            <DataTableRow key={property.id} tracks={3}>
              <DataTableCell className="row-span-2 min-w-0 whitespace-normal">
                <PropertyNameCell row={row} />
              </DataTableCell>
              {figures ? (
                <>
                  <DataTableCell className="col-start-2 row-start-1 text-right">
                    <RatingValue comparison={comparison} fleet={fleet} />
                  </DataTableCell>
                  <DataTableCell className="col-start-2 row-start-2 text-right text-xs text-muted-foreground @4xl:text-sm @4xl:text-foreground">
                    <ReviewsValue comparison={comparison} fleet={fleet} />
                  </DataTableCell>
                  <DataTableCell
                    className={cn(
                      'col-span-3 whitespace-normal',
                      // Stacked, a row with nothing waiting says nothing.
                      clear && '@max-4xl:hidden',
                    )}
                  >
                    <AttentionValue
                      comparison={comparison}
                      fleet={fleet}
                      propertyId={property.id}
                      propertyName={property.name}
                    />
                  </DataTableCell>
                </>
              ) : null}
              {setupShown ? (
                <DataTableCell
                  className={cn(
                    'col-span-3 whitespace-normal',
                    setUp && '@max-4xl:hidden',
                  )}
                >
                  <SetupValue
                    setup={row.setup}
                    state={setup}
                    propertyId={property.id}
                    propertyName={property.name}
                  />
                </DataTableCell>
              ) : null}
              <DataTableCell className="col-start-3 row-span-2 row-start-1 -mt-2 -mr-3 self-start @4xl:mt-0 @4xl:mr-0 @4xl:px-2 @4xl:text-right">
                <PropertyRowActions
                  propertyId={property.id}
                  propertyName={property.name}
                />
              </DataTableCell>
            </DataTableRow>
          )
        })}
      </DataTableBody>
    </DataTable>
  )
}
