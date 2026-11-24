import type {
  FindGoalMetricCorrectionImpactsInput,
  findGoalMetricCorrectionImpacts,
} from './goal-metric-correction-impact-lookup.server'
import type {
  FindClosedGoalResultIdsForMetricImpactInput,
  GoalProgramRepository,
} from '../application/ports/goal-program.repository'

export type ReconcileMetricCorrectionInput = FindGoalMetricCorrectionImpactsInput

export type ReconcileMetricCorrectionResult = Readonly<{
  impactCount: number
  candidateCount: number
  revised: number
  unchanged: number
}>

type ClosedResultReconciliation = Readonly<{
  status: 'revised' | 'unchanged' | 'pending'
}>

export type ReconcileMetricCorrectionDependencies = Readonly<{
  findImpacts: (
    input: FindGoalMetricCorrectionImpactsInput,
  ) => ReturnType<typeof findGoalMetricCorrectionImpacts>
  findCandidates: GoalProgramRepository['findClosedResultIdsForMetricImpact']
  reconcileClosedResult(input: {
    organizationId: string
    propertyId: string
    resultId: string
  }): Promise<ClosedResultReconciliation>
}>

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/**
 * Re-evaluates only the immutable, closed Goal results proven affected by a
 * Metric correction. Metric owns reading facts; Goal owns candidate selection
 * and result revision. No context reaches into the other's repositories.
 */
export function reconcileMetricCorrection(deps: ReconcileMetricCorrectionDependencies) {
  return async (
    input: ReconcileMetricCorrectionInput,
  ): Promise<ReconcileMetricCorrectionResult> => {
    const impacts = await deps.findImpacts(input)

    const candidateIds = new Set<string>()
    for (const impact of impacts) {
      const candidateInput: FindClosedGoalResultIdsForMetricImpactInput = {
        organizationId: impact.organizationId,
        propertyId: impact.propertyId,
        definitionVersionId: impact.definitionVersionId,
        portalId: impact.portalId,
        portalGroupId: impact.portalGroupId,
        eventAt: impact.eventAt,
      }
      for (const resultId of await deps.findCandidates(candidateInput)) {
        candidateIds.add(resultId)
      }
    }

    let revised = 0
    let unchanged = 0
    for (const resultId of [...candidateIds].sort(compareIds)) {
      const result = await deps.reconcileClosedResult({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        resultId,
      })
      if (result.status === 'pending') {
        // No receipt must be committed while Metric still reports an updating
        // source. The durable dispatcher retries, and earlier revisions remain
        // safe because appendResultRevision is CAS-guarded and replay-stable.
        throw new Error('Goal metric correction reconciliation is pending')
      }
      if (result.status === 'revised') revised++
      else unchanged++
    }

    return {
      impactCount: impacts.length,
      candidateCount: candidateIds.size,
      revised,
      unchanged,
    }
  }
}

export type ReconcileMetricCorrection = ReturnType<typeof reconcileMetricCorrection>
