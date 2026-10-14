// The Properties list's "Google goal" cell (decision 13), from the stored goal
// the fleet read carries: a goal's target and status open the goal's page,
// "Set goal" opens the wizard on the Goals page, and a dash says there is
// neither. In the table the target and the status are two deliberate lines
// (the target never breaks; the longest status, "Can’t reach at this mix",
// gets a line of its own); stacked on a phone they are one quiet line of the
// row, "Google goal: 4.5 · On pace", whose link is padded into a tap target
// that stays inside the row's gaps. "Set goal" is the column's one action, so
// it is in the medium weight with a chevron that says it goes on (to the
// wizard), in the text's ink as every link in a row but the name
// (`row-link.ts`). It is not an add, so not a Plus (`AddAction`), and the
// chevron is the sidebar's, already in first paint.
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { RATING_GOAL_ARRIVAL_SEARCH } from '#/components/goals/rating-goal-arrival-search'
import { Skeleton } from '#/components/ui/skeleton'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { googleGoalCell } from './property-list-goal'
import type { DataState, PropertyComparison } from './property-list-view'

/**
 * Stacked, the line is 16px and the row's gap 6px: the link reaches 6px above
 * and below into the gaps (28px), never over the lines beside it. In the table
 * it is the text it holds.
 */
const PHONE_TAP_AREA = 'min-h-7 -my-1.5 @4xl:min-h-0 @4xl:my-0'

/**
 * "4.5" over "On pace" in the table (the goal's page), "Set goal" (the wizard),
 * or a dash. Stacked on a phone it is one quiet line, named "Google goal"; in
 * the table the column header names it.
 */
export function GoogleGoalValue({
  comparison,
  fleet,
  propertyId,
  propertyName,
}: Readonly<{
  comparison: PropertyComparison | undefined
  fleet: DataState
  propertyId: string
  propertyName: string
}>) {
  const { can } = usePermissions()
  if (!comparison) {
    return fleet === 'loading' ? (
      <Skeleton className="h-4 w-20" aria-hidden="true" />
    ) : null
  }
  const cell = googleGoalCell(comparison.ratingGoal, can('goal.create'))
  const label = <span className="@4xl:sr-only">Google goal: </span>
  if (cell.kind === 'none') {
    return (
      <span className="text-muted-foreground">
        {label}
        <span aria-hidden="true">–</span>
        <span className="sr-only">none</span>
      </span>
    )
  }
  if (cell.kind === 'set') {
    return (
      <span>
        {label}
        <Link
          to="/properties/$propertyId/goals"
          params={{ propertyId }}
          search={RATING_GOAL_ARRIVAL_SEARCH}
          aria-label={`Set goal: Google rating goal for ${propertyName}`}
          className={cn(
            'inline-flex items-center gap-1 align-middle font-medium',
            PHONE_TAP_AREA,
            ROW_FIGURE_LINK,
          )}
        >
          Set goal
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        </Link>
      </span>
    )
  }
  return (
    <span>
      {label}
      <Link
        to="/properties/$propertyId/goals/google-rating"
        params={{ propertyId }}
        aria-label={`${cell.text}: Google rating goal for ${propertyName}`}
        className={cn(
          'inline-flex items-center align-middle tabular-nums @4xl:flex-col @4xl:items-start @4xl:gap-0.5',
          PHONE_TAP_AREA,
          ROW_FIGURE_LINK,
        )}
      >
        <span className="whitespace-nowrap @4xl:font-medium">{cell.target}</span>
        {cell.status === null ? null : (
          <span className="@4xl:text-xs @4xl:text-muted-foreground">
            <span aria-hidden="true" className="mx-1 @4xl:hidden">
              ·
            </span>
            {cell.status}
          </span>
        )}
      </Link>
    </span>
  )
}
