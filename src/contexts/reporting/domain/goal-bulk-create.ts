// Setting goals for several subjects in one save.
//
// Each row becomes its own goal with one subject, so a row names what a manager
// sets goals for one at a time: a Portal or a Portal Group. A goal for the
// Property as a whole is one goal and is set on its own.
//
// Its own module, apart from the Program's other rules, because the save's
// transport schema reads it and loads with the table, not with first paint.
import type { GoalSubject } from './goal-subject'

/** The most goals one save may create. */
export const MAX_GOAL_BULK_ITEMS = 50

export type GoalBulkSubject = Exclude<GoalSubject, Readonly<{ kind: 'property' }>>

export const isGoalBulkSubject = (subject: GoalSubject): subject is GoalBulkSubject =>
  subject.kind !== 'property'
