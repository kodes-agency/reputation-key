export type FindGoalMetricCorrectionImpactsInput = Readonly<{
  organizationId: string
  propertyId: string
  definitionVersionId: string
  correctedReadingId: string
  replacementReadingId: string | null
}>

/** Metric-owned, identifier-only fact used to locate affected closed Goals. */
export type GoalMetricCorrectionImpact = Readonly<{
  readingId: string
  organizationId: string
  propertyId: string
  definitionVersionId: string
  portalId: string | null
  portalGroupId: string | null
  eventAt: Date
}>

export type GoalMetricCorrectionImpactLookup = Readonly<{
  findGoalMetricCorrectionImpacts(
    input: FindGoalMetricCorrectionImpactsInput,
  ): Promise<readonly GoalMetricCorrectionImpact[]>
}>
