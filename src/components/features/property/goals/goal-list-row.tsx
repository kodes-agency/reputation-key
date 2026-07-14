import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { GoalProgressTrack } from './goal-progress-track'
import type { GoalListItem } from './goal-list-types'
import { scopeLabel, statusBadgeVariant, statusLabel } from '#/contexts/goal/ui/helpers'
import { deriveEntityScope } from '#/contexts/goal/application/public-api'

export function GoalRow({
  item,
  propertyId,
}: Readonly<{
  item: GoalListItem
  propertyId: string
}>) {
  const { goal, presentation } = item
  const scope = deriveEntityScope(goal)

  return (
    <Link
      to="/properties/$propertyId/goals/$goalId"
      params={{ propertyId, goalId: goal.id }}
      className="group grid gap-3 px-4 py-4 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)_auto] sm:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="max-w-full truncate font-medium group-hover:underline">
            {goal.name}
          </span>
          <Badge variant={statusBadgeVariant(goal.status)}>
            {statusLabel(goal.status)}
          </Badge>
          {scope !== 'property' && <Badge variant="outline">{scopeLabel(scope)}</Badge>}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {presentation.statusMessage}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <GoalProgressTrack
          currentValue={presentation.currentValue}
          targetValue={presentation.targetValue}
          percent={presentation.progressPercent}
          label={presentation.progressLabel}
          status={goal.status}
          attention={presentation.attention}
          expectedPercent={presentation.expectedPercent}
          showExpectedMarker={presentation.showExpectedMarker}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums text-foreground">
            {presentation.progressLabel}
          </span>
          <span>{presentation.timeframeLabel}</span>
          <span>{presentation.remainingLabel}</span>
        </div>
      </div>

      <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
    </Link>
  )
}

export function GoalEmptyState({
  icon,
  title,
  description,
  propertyId,
  canCreateGoal,
}: Readonly<{
  icon: LucideIcon
  title: string
  description: string
  propertyId: string
  canCreateGoal: boolean
}>) {
  return (
    <EmptyState icon={icon} title={title}>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {canCreateGoal && (
        <Button asChild size="sm">
          <Link to="/properties/$propertyId/goals/new" params={{ propertyId }}>
            <Plus data-icon="inline-start" />
            New Goal
          </Link>
        </Button>
      )}
    </EmptyState>
  )
}
