// What opens the Monthly portal goal's sheet (PLAN PG-10, PG-14): a set on the
// measure its door names, on the month the read names, or on one month only
// (a stopped goal's way to the next goal); or a change of the goal, on the
// measure its door names (`portal-goal-sheet-change-view.ts`). Types only.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'

/** A set: the measure its door names, and the one month a stopped goal's door names. */
export type PortalGoalSetIntent = Readonly<{
  mode?: 'set'
  measure: PortalGoalMeasure
  month?: string
}>

export type PortalGoalSheetIntent =
  PortalGoalSetIntent | Readonly<{ mode: 'change'; measure: PortalGoalMeasure }>
