import type { StatusMap } from '#/components/ui/status-badge'
import type { GoalProgram } from '#/contexts/reporting/application/public-api'

/** How a goal program's status reads as a pill, on the list and on the goal. */
export const GOAL_STATUS: StatusMap<GoalProgram['status']> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'warn' },
  ended: { label: 'Ended', tone: 'neutral' },
}
