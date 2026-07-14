import type { Goal, GoalType } from '#/contexts/goal/application/public-api'
import type {
  GoalListView,
  GoalPresentation,
  GoalWithProgress,
  HistoryGoalStatus,
} from '#/contexts/goal/ui/helpers'

export type GoalListItem = GoalWithProgress & Readonly<{ presentation: GoalPresentation }>

export type GoalSearch = Readonly<{
  view: GoalListView
  historyStatus?: HistoryGoalStatus
  goalType?: GoalType
}>

export const GOAL_TYPES: readonly GoalType[] = [
  'one_shot',
  'recurring',
  'rolling',
  'open',
]

export const HISTORY_STATUSES: readonly HistoryGoalStatus[] = [
  'completed',
  'expired',
  'cancelled',
]

export function goalSearch(search: GoalSearch) {
  return {
    view: search.view,
    historyStatus: search.view === 'history' ? search.historyStatus : undefined,
    goalType: search.goalType,
  } as never
}

export function compareActiveGoals(a: GoalListItem, b: GoalListItem): number {
  const priorityDiff = a.presentation.sortPriority - b.presentation.sortPriority
  if (priorityDiff !== 0) return priorityDiff
  return b.goal.createdAt.getTime() - a.goal.createdAt.getTime()
}

export function compareHistoryGoals(a: GoalListItem, b: GoalListItem): number {
  const statusDiff = historyStatusOrder(a.goal.status) - historyStatusOrder(b.goal.status)
  if (statusDiff !== 0) return statusDiff
  return b.goal.updatedAt.getTime() - a.goal.updatedAt.getTime()
}

export function historySectionDescription(status: HistoryGoalStatus): string {
  switch (status) {
    case 'completed':
      return 'Targets that were reached.'
    case 'expired':
      return 'Targets that ended before they were reached.'
    case 'cancelled':
      return 'Targets stopped manually.'
  }
}

function historyStatusOrder(status: Goal['status']): number {
  switch (status) {
    case 'completed':
      return 0
    case 'expired':
      return 1
    case 'cancelled':
      return 2
    case 'active':
      return 3
  }
}
