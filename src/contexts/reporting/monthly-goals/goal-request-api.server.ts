import type { GoalProgramRequestApi } from './goal-programs.server'
import type { GoalProgressRequestApi } from './goal-progress.server'
import type { GoalListProgressRequestApi } from './goal-list-progress.server'
import type { MonthlyPortalGoalRequestApi } from './monthly-portal-goal-page.server'
import type { PortalGoalAddRequestApi } from './portal-goal-add.server'
import type { PortalGoalSinglePageRequestApi } from './get-portal-goal-page.server'

/** Every Goal request member, each taking the request's policy first. */
export type GoalRequestApi = GoalProgramRequestApi &
  GoalProgressRequestApi &
  GoalListProgressRequestApi &
  MonthlyPortalGoalRequestApi &
  PortalGoalAddRequestApi &
  PortalGoalSinglePageRequestApi
