// The governed page read and set-based pace reads share metric-version eligibility,
// so retired, limited or not-yet-effective versions are unavailable in both.

import type { MetricKey } from '#/shared/domain/metric-keys'
import type { GovernedMetricVersion, MetricScope } from '../readings/contracts'

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
