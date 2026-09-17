// The Properties list as one table (docs/plan/property-list-table.md rows 2–3).
//
// One DOM for every width: a property's name renders once, which the e2e
// journeys and Storybook (no CSS there) both rely on. Below a 56 rem container
// each row stacks as a small grid — name and rating, then reviews, then the
// work and setup lines — and the header row is not shown; from 56 rem it is a
// table with sortable column headers.
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { cn } from '#/lib/utils'
import type { PropertyListSort } from './property-list-search-schema'
import {
  AttentionValue,
  PropertyNameCell,
  RatingValue,
  ReviewsValue,
  SetupValue,
} from './property-list-cells'
import type { DataState, PropertyListRow, PropertyListView } from './property-list-view'

type Props = Readonly<{
  rows: ReadonlyArray<PropertyListRow>
  view: PropertyListView
  fleet: DataState
  setup: DataState
  onSort: (sort: PropertyListSort) => void
}>

function SortableHead({
  column,
  view,
  onSort,
  align = 'start',
  className,
  children,
}: Readonly<{
  column: PropertyListSort
  view: PropertyListView
  onSort: (sort: PropertyListSort) => void
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}>) {
  const active = view.sort === column
  const Icon = active ? (view.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead
      aria-sort={active ? (view.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('h-10 px-4', align === 'end' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          '-mx-1 inline-flex h-8 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          active && 'text-foreground',
          align === 'end' && 'flex-row-reverse',
        )}
      >
        {children}
        <Icon className={cn('size-3.5', !active && 'opacity-40')} aria-hidden="true" />
      </button>
    </TableHead>
  )
}

const CELL = 'p-0 @4xl:table-cell @4xl:px-4 @4xl:py-3'

export function PropertyListTable({ rows, view, fleet, setup, onSort }: Props) {
  const figures = fleet !== 'unavailable'
  const setupShown = setup !== 'unavailable'
  const head = { view, onSort }

  return (
    <div className="overflow-hidden rounded-lg border bg-card @container">
      <Table aria-label="Properties" className="block @4xl:table">
        <TableHeader className="hidden @4xl:table-header-group">
          <TableRow className="hover:bg-transparent">
            <SortableHead column="name" {...head}>
              Property
            </SortableHead>
            {figures ? (
              <>
                <SortableHead column="rating" align="end" className="w-24" {...head}>
                  Rating
                </SortableHead>
                <SortableHead column="reviews" align="end" className="w-24" {...head}>
                  Reviews
                </SortableHead>
                <SortableHead column="attention" className="w-56" {...head}>
                  Needs attention
                </SortableHead>
              </>
            ) : null}
            {setupShown ? (
              <SortableHead column="setup" className="w-52" {...head}>
                Setup
              </SortableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody className="block @4xl:table-row-group">
          {rows.map((row) => {
            const { property, comparison } = row
            const clear = comparison !== undefined && comparison.attention.total === 0
            const setUp = row.setup !== undefined && row.setup.nextStep === null
            return (
              <TableRow
                key={property.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3.5 hover:bg-muted/40 @4xl:table-row @4xl:p-0"
              >
                <TableCell className={cn(CELL, 'row-span-2 min-w-0 whitespace-normal')}>
                  <PropertyNameCell row={row} />
                </TableCell>
                {figures ? (
                  <>
                    <TableCell className={cn(CELL, 'col-start-2 row-start-1 text-right')}>
                      <RatingValue comparison={comparison} fleet={fleet} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        CELL,
                        'col-start-2 row-start-2 text-right text-xs text-muted-foreground @4xl:text-sm @4xl:text-foreground',
                      )}
                    >
                      <ReviewsValue comparison={comparison} fleet={fleet} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        CELL,
                        'col-span-2 whitespace-normal',
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
                    </TableCell>
                  </>
                ) : null}
                {setupShown ? (
                  <TableCell
                    className={cn(
                      CELL,
                      'col-span-2 whitespace-normal',
                      setUp && '@max-4xl:hidden',
                    )}
                  >
                    <SetupValue
                      setup={row.setup}
                      state={setup}
                      propertyId={property.id}
                      propertyName={property.name}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
