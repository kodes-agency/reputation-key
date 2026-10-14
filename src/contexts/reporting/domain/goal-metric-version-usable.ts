// Reporting — whether a governed metric version may answer a goal's question.
//
// One rule for every read of a goal's measure: the governed read of a goal's own
// page and the set-based count behind the Overview chip and the Properties list
// ask it, so a version that is retired, limited or not yet in effect is
// unavailable to both and the two cannot disagree. Pure.

import type { MetricKey } from '#/shared/domain/metric-keys'
import type { GovernedMetricVersion, MetricScope } from './metric-registry'

export type GoalVersionUse = Readonly<{
  /** The measure the goal asks for. */
  metricKey: MetricKey
  subjectKind: MetricScope
  /** The month asked about, as instants. */
  periodStart: Date
  periodEnd: Date
}>

/**
 * Whether `governed` is an approved version of the measure, open to goals and
 * to this kind of subject, and in effect for the whole of the month.
 */
export function goalVersionIsUsable(
  governed: GovernedMetricVersion,
  use: GoalVersionUse,
): boolean {
  const { definition, version } = governed
  return (
    definition.lifecycleStatus === 'approved' &&
    definition.key === use.metricKey &&
    version.permittedConsumers.includes('goal') &&
    version.employmentDecisionEligible === false &&
    version.allowedScopes.includes(use.subjectKind) &&
    version.effectiveFrom <= use.periodStart &&
    (version.effectiveTo === null || version.effectiveTo >= use.periodEnd)
  )
}
