// The Properties list's "Google goal" cell (decision 13), from the stored goal
// the fleet read carries: "4.5 · On pace" opens the goal's page, "Set goal" the
// Goals page (where the wizard opens), and a dash says there is neither.
import { Link } from '@tanstack/react-router'
import { Skeleton } from '#/components/ui/skeleton'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { googleGoalCell } from './property-list-goal'
import type { DataState, PropertyComparison } from './property-list-view'

/**
 * "4.5 · On pace" (the goal's page), "Set goal" (the Goals page, where the
 * wizard opens) or a dash. Stacked on a phone it is one quiet line of the row,
 * named "Google goal"; in the table the column header names it.
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
  const label = <span className="@4xl:sr-only">Google goal </span>
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
          aria-label={`Set goal: Google rating goal for ${propertyName}`}
          className={cn('font-medium', ROW_FIGURE_LINK)}
        >
          Set goal
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
        className={cn('tabular-nums', ROW_FIGURE_LINK)}
      >
        {cell.text}
      </Link>
    </span>
  )
}
