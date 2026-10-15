// The Properties list as one table (docs/plan/property-list-table.md rows 2–3).
//
// One DOM for every width: a property's name renders once, which the e2e
// journeys and Storybook (no CSS there) both rely on. Below a 56 rem container
// each row stacks as a small grid — name and rating, then reviews, then the
// Google goal, work and setup lines — and the header row is not shown; from
// 56 rem it is a table with sortable column headers.
//
// Rating and Reviews are Google's own number and count (decision 16). The
// Google goal column (decision 13) shows where the reader may read goals and
// Goals are on; it reads the stored goal, never a live evaluation.
import { useState } from 'react'
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
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { googleGoalCell } from './property-list-goal'
import type { PropertyListSort } from './property-list-search-schema'
import { GoogleGoalValue } from './property-list-goal-value'
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
  const [now] = useState(() => new Date())
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const figures = fleet !== 'unavailable'
  const goals = figures && can('goal.read') && has('goal.use')
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
            {/* Room for the longest status ("Can’t reach at this mix") on its own line. */}
            {goals ? <DataTableHead className="w-40">Google goal</DataTableHead> : null}
            <SortHead column="attention" className={goals ? 'w-48' : 'w-56'} {...head}>
              Needs attention
            </SortHead>
          </>
        ) : null}
        {setupShown ? (
          <SortHead column="setup" className={goals ? 'w-48' : 'w-52'} {...head}>
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
          const noGoal =
            comparison !== undefined &&
            googleGoalCell(comparison.ratingGoal, can('goal.create')).kind === 'none'
          return (
            <DataTableRow key={property.id} tracks={3}>
              <DataTableCell className="row-span-2 min-w-0 whitespace-normal">
                <PropertyNameCell row={row} />
              </DataTableCell>
              {figures ? (
                <>
                  <DataTableCell className="col-start-2 row-start-1 text-right">
                    <RatingValue comparison={comparison} fleet={fleet} now={now} />
                  </DataTableCell>
                  <DataTableCell className="col-start-2 row-start-2 text-right text-xs text-muted-foreground @4xl:text-sm @4xl:text-foreground">
                    <ReviewsValue comparison={comparison} fleet={fleet} />
                  </DataTableCell>
                  {goals ? (
                    <DataTableCell
                      className={cn(
                        'col-span-3 text-xs whitespace-normal text-muted-foreground @4xl:text-sm @4xl:text-foreground',
                        // Stacked, a row with no goal and none to set says nothing.
                        noGoal && '@max-4xl:hidden',
                      )}
                    >
                      <GoogleGoalValue
                        comparison={comparison}
                        fleet={fleet}
                        propertyId={property.id}
                        propertyName={property.name}
                      />
                    </DataTableCell>
                  ) : null}
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
              <DataTableCell
                actions
                className="col-start-3 row-span-2 row-start-1 self-start"
              >
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
