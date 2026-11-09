import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'

/** A set: the measure its door names, and the one month a stopped goal's door names. */
export type PortalGoalSetIntent = Readonly<{
  mode?: 'set'
  measure: PortalGoalMeasure
  month?: string
}>

export type PortalGoalSheetIntent =
  PortalGoalSetIntent | Readonly<{ mode: 'change'; measure: PortalGoalMeasure }>
