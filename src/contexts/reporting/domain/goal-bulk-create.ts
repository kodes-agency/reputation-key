// Each bulk row is a single-subject Portal or Portal Group goal; Property goals
// are set separately. Keep these rules outside the first-paint Program module.

import type { GoalSubject } from './goal-subject'

/** The most goals one save may create. */
export const MAX_GOAL_BULK_ITEMS = 50

export type GoalBulkSubject = Exclude<GoalSubject, Readonly<{ kind: 'property' }>>

export const isGoalBulkSubject = (subject: GoalSubject): subject is GoalBulkSubject =>
  subject.kind !== 'property'
