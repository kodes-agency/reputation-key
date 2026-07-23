import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import {
  getGoalPresentation,
  type GoalListView,
  type GoalWithProgress,
  type HistoryGoalStatus,
} from '#/contexts/goal/ui/helpers'
import type { GoalType } from '#/contexts/goal/application/public-api'
import { ActiveGoalsView, HistoryGoalsView } from './goal-list-sections'
import { GoalsToolbar } from './goal-list-toolbar'
import {
  compareActiveGoals,
  compareHistoryGoals,
  type GoalListItem,
} from './goal-list-types'

type GoalsListPageProps = Readonly<{
  goals: readonly GoalWithProgress[]
  propertyId: string
  propertyName: string
  view?: GoalListView
  historyStatus?: HistoryGoalStatus
  goalType?: GoalType
  canCreateGoal?: boolean
  /** BQC-5.3: the render edge owns the wall clock — inject a fixed value in stories/tests for deterministic pace. */
  now?: Date
}>

type GoalListModel = Readonly<{
  activeItems: GoalListItem[]
  historyItems: GoalListItem[]
  totalGoalCount: number
  allActiveCount: number
  allHistoryCount: number
  needsAttentionCount: number
  onTrackCount: number
}>

/** Builds the list view model: presentations, active/history partitions, counts. */
function buildGoalListModel(
  goals: readonly GoalWithProgress[],
  goalType: GoalType | undefined,
  historyStatus: HistoryGoalStatus | undefined,
  now: Date,
): GoalListModel {
  const typedGoals = goalType
    ? goals.filter(({ goal }) => goal.goalType === goalType)
    : goals
  const items: GoalListItem[] = typedGoals.map((entry) => ({
    ...entry,
    presentation: getGoalPresentation(entry.goal, entry.progress, now),
  }))

  const activeItems = items
    .filter(({ goal }) => goal.status === 'active')
    .sort(compareActiveGoals)
  const historyItems = items
    .filter(({ goal }) => goal.status !== 'active')
    .filter(({ goal }) => !historyStatus || goal.status === historyStatus)
    .sort(compareHistoryGoals)

  const allActiveCount = typedGoals.filter(({ goal }) => goal.status === 'active').length
  return {
    activeItems,
    historyItems,
    totalGoalCount: typedGoals.length,
    allActiveCount,
    allHistoryCount: typedGoals.length - allActiveCount,
    needsAttentionCount: activeItems.filter(
      ({ presentation }) => presentation.attention === 'needs-attention',
    ).length,
    onTrackCount: activeItems.filter(
      ({ presentation }) => presentation.attention === 'on-track',
    ).length,
  }
}

export function GoalsListPage({
  goals,
  propertyId,
  propertyName,
  view = 'active',
  historyStatus,
  goalType,
  canCreateGoal = true,
  now = new Date(),
}: GoalsListPageProps) {
  const {
    activeItems,
    historyItems,
    totalGoalCount,
    allActiveCount,
    allHistoryCount,
    needsAttentionCount,
    onTrackCount,
  } = buildGoalListModel(goals, goalType, historyStatus, now)

  return (
    <PageShell className="flex flex-col gap-5 md:gap-6">
      <PageHeader
        title="Goals"
        description="Track active targets and review past outcomes."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Goals' },
        ]}
        actions={
          canCreateGoal ? (
            <Button asChild>
              <Link to="/properties/$propertyId/goals/new" params={{ propertyId }}>
                <Plus data-icon="inline-start" />
                New Goal
              </Link>
            </Button>
          ) : undefined
        }
      />

      <GoalsToolbar
        propertyId={propertyId}
        view={view}
        historyStatus={historyStatus}
        goalType={goalType}
        activeCount={allActiveCount}
        historyCount={allHistoryCount}
      />

      {view === 'active' ? (
        <ActiveGoalsView
          items={activeItems}
          propertyId={propertyId}
          canCreateGoal={canCreateGoal}
          totalGoalCount={totalGoalCount}
          needsAttentionCount={needsAttentionCount}
          onTrackCount={onTrackCount}
        />
      ) : (
        <HistoryGoalsView
          items={historyItems}
          propertyId={propertyId}
          historyStatus={historyStatus}
          goalType={goalType}
          totalGoalCount={totalGoalCount}
        />
      )}
    </PageShell>
  )
}
