import { Archive, Target } from 'lucide-react'
import { statusLabel, type HistoryGoalStatus } from '#/contexts/goal/ui/helpers'
import type { GoalType } from '#/contexts/goal/application/public-api'
import { FilterLink } from './goal-list-toolbar'
import { GoalEmptyState, GoalRow } from './goal-list-row'
import {
  HISTORY_STATUSES,
  historySectionDescription,
  type GoalListItem,
} from './goal-list-types'

export function ActiveGoalsView({
  items,
  propertyId,
  canCreateGoal,
  totalGoalCount,
  needsAttentionCount,
  onTrackCount,
}: Readonly<{
  items: readonly GoalListItem[]
  propertyId: string
  canCreateGoal: boolean
  totalGoalCount: number
  needsAttentionCount: number
  onTrackCount: number
}>) {
  if (items.length === 0) {
    return (
      <GoalEmptyState
        icon={Target}
        title={totalGoalCount === 0 ? 'No goals yet' : 'No active goals'}
        description={
          totalGoalCount === 0
            ? 'Create the first goal for this property.'
            : 'Past goals are available in History.'
        }
        propertyId={propertyId}
        canCreateGoal={canCreateGoal}
      />
    )
  }

  const otherCount = items.length - needsAttentionCount - onTrackCount

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{items.length} active</span>
        {needsAttentionCount > 0 && ` · ${needsAttentionCount} need attention`}
        {onTrackCount > 0 && ` · ${onTrackCount} on track`}
        {otherCount > 0 && ` · ${otherCount} other`}
      </p>
      <GoalListSection
        title="Needs attention"
        description="Behind the expected pace or past the period end."
        items={items.filter(
          ({ presentation }) => presentation.attention === 'needs-attention',
        )}
        propertyId={propertyId}
      />
      <GoalListSection
        title="On track"
        description="On pace, ahead, or already at the target."
        items={items.filter(({ presentation }) => presentation.attention === 'on-track')}
        propertyId={propertyId}
      />
      <GoalListSection
        title="Other active goals"
        description="Open, rolling, recurring, or future goals without time pace."
        items={items.filter(({ presentation }) => presentation.attention === 'other')}
        propertyId={propertyId}
      />
    </div>
  )
}

export function HistoryGoalsView({
  items,
  propertyId,
  historyStatus,
  goalType,
  totalGoalCount,
}: Readonly<{
  items: readonly GoalListItem[]
  propertyId: string
  historyStatus?: HistoryGoalStatus
  goalType?: GoalType
  totalGoalCount: number
}>) {
  if (items.length === 0) {
    return (
      <GoalEmptyState
        icon={Archive}
        title={totalGoalCount === 0 ? 'No goals yet' : 'No history yet'}
        description={
          totalGoalCount === 0
            ? 'Create a goal to start building history.'
            : 'Completed, expired, and cancelled goals will appear here.'
        }
        propertyId={propertyId}
        canCreateGoal={false}
      />
    )
  }

  const statuses = historyStatus ? [historyStatus] : HISTORY_STATUSES

  return (
    <div className="flex flex-col gap-5">
      <HistoryStatusFilters
        propertyId={propertyId}
        activeStatus={historyStatus}
        goalType={goalType}
      />
      {statuses.map((status) => (
        <GoalListSection
          key={status}
          title={statusLabel(status)}
          description={historySectionDescription(status)}
          items={items.filter(({ goal }) => goal.status === status)}
          propertyId={propertyId}
        />
      ))}
    </div>
  )
}

function GoalListSection({
  title,
  description,
  items,
  propertyId,
}: Readonly<{
  title: string
  description: string
  items: readonly GoalListItem[]
  propertyId: string
}>) {
  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="divide-y rounded-lg border">
        {items.map((item) => (
          <GoalRow key={item.goal.id} item={item} propertyId={propertyId} />
        ))}
      </div>
    </section>
  )
}

function HistoryStatusFilters({
  propertyId,
  activeStatus,
  goalType,
}: Readonly<{
  propertyId: string
  activeStatus?: HistoryGoalStatus
  goalType?: GoalType
}>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <FilterLink
        propertyId={propertyId}
        search={{ view: 'history', goalType }}
        active={!activeStatus}
      >
        All history
      </FilterLink>
      {HISTORY_STATUSES.map((status) => (
        <FilterLink
          key={status}
          propertyId={propertyId}
          search={{ view: 'history', historyStatus: status, goalType }}
          active={activeStatus === status}
        >
          {statusLabel(status)}
        </FilterLink>
      ))}
    </div>
  )
}
