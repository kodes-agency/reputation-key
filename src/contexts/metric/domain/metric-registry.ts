// POST-BETA-3 PB3.0-PB3.1: Governed metric registry.
//
// Per ADR 0041: a centralized, code-reviewed registry is the ONLY route
// from source facts to goals, badges, leaderboards, and governed
// dashboard metrics. Application code references a version ID, not an
// ad-hoc formula.
//
// Rules:
// - Material rule changes create a new version; they never mutate historical meaning.
// - The registry FAILS CLOSED: unknown source/version produces no reading.
// - employment_decision_eligible is permanently false in post-beta v1.

export type MetricValueKind = 'counter' | 'duration' | 'level' | 'ratio' | 'average'
export type MetricLifecycleStatus = 'draft' | 'approved' | 'retired'
export type SourcePolicyClass =
  | 'google_property_derivative'
  | 'review_solicitation_analytics_only'
  | 'first_party_guest_private'
  | 'first_party_workflow'
  | 'manager_confirmed_recognition'
export type MetricScope = 'property' | 'portal_group' | 'portal'
export type PermittedConsumer =
  | 'dashboard'
  | 'goal'
  | 'badge'
  | 'leaderboard'
  | 'notification'
  | 'export'

export type InsufficientDataBehavior = 'unavailable' | 'zero' | 'quarantine'

export interface MetricDefinition {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly description: string
  readonly valueKind: MetricValueKind
  readonly workerDataFlag: boolean
  readonly privacyClass: string
  readonly retentionClass: string
  readonly lifecycleStatus: MetricLifecycleStatus
  readonly approvalOwner: string
}

export interface MetricDefinitionVersion {
  readonly id: string
  readonly definitionId: string
  readonly version: number
  readonly effectiveFrom: Date
  readonly effectiveTo: Date | null
  readonly numeratorDescription: string
  readonly denominatorDescription: string | null
  readonly unit: string
  readonly precision: number
  readonly aggregationRule: string
  readonly lateArrivalRule: string
  readonly allowedScopes: readonly MetricScope[]
  readonly attributionRule: string
  readonly minimumSample: number
  readonly insufficientDataBehavior: InsufficientDataBehavior
  readonly sourcePolicyAllowlist: readonly SourcePolicyClass[]
  readonly permittedConsumers: readonly PermittedConsumer[]
  readonly employmentDecisionEligible: false
  readonly correctionBehavior: string
  readonly fairnessReviewStatus: string
}

export interface MetricRegistryEntry {
  readonly definition: MetricDefinition
  readonly versions: readonly MetricDefinitionVersion[]
}

/**
 * Get the active version of a metric definition as of a given time.
 * Returns null if no version is active.
 */
export function getActiveVersion(
  entry: MetricRegistryEntry,
  asOf: Date = new Date(),
): MetricDefinitionVersion | null {
  const active = entry.versions.filter((v) => {
    if (v.effectiveFrom > asOf) return false
    if (v.effectiveTo !== null && asOf >= v.effectiveTo) return false
    return true
  })
  // Return the most recent active version
  return active.sort((a, b) => b.version - a.version)[0] ?? null
}

/**
 * Check if a source policy class is allowed for a metric version.
 * Per ADR 0041: the registry fails closed.
 */
export function isSourcePolicyAllowed(
  version: MetricDefinitionVersion,
  sourceClass: SourcePolicyClass,
): boolean {
  return version.sourcePolicyAllowlist.includes(sourceClass)
}

/**
 * Check if a consumer is permitted for a metric version.
 */
export function isConsumerPermitted(
  version: MetricDefinitionVersion,
  consumer: PermittedConsumer,
): boolean {
  return version.permittedConsumers.includes(consumer)
}

/**
 * Check if a scope is allowed for a metric version.
 */
export function isScopeAllowed(
  version: MetricDefinitionVersion,
  scope: MetricScope,
): boolean {
  return version.allowedScopes.includes(scope)
}

/**
 * Determine the result when sample is insufficient.
 * Per ADR 0041: missing data is 'unavailable', never silently zero.
 */
export function evaluateInsufficientData(
  version: MetricDefinitionVersion,
  sampleSize: number,
): { insufficient: boolean; behavior: InsufficientDataBehavior; result: number | null } {
  if (sampleSize >= version.minimumSample) {
    return {
      insufficient: false,
      behavior: version.insufficientDataBehavior,
      result: null,
    }
  }
  switch (version.insufficientDataBehavior) {
    case 'unavailable':
      return { insufficient: true, behavior: 'unavailable', result: null }
    case 'zero':
      return { insufficient: true, behavior: 'zero', result: 0 }
    case 'quarantine':
      return { insufficient: true, behavior: 'quarantine', result: null }
  }
}

/**
 * Architectural constraint: certain source classes are NEVER eligible
 * for goals, badges, or leaderboards — even if they appear in a metric
 * definition's permitted consumers.
 *
 * Per ADRs 0041/0043: review-solicitation and Google-restricted sources
 * cannot enter staff gamification by any code path.
 */
const GAMIFICATION_BLOCKED_SOURCES: ReadonlySet<SourcePolicyClass> = new Set([
  'google_property_derivative',
  'review_solicitation_analytics_only',
])

const GAMIFICATION_CONSUMERS: ReadonlySet<PermittedConsumer> = new Set([
  'goal',
  'badge',
  'leaderboard',
])

export function isGamificationViolation(version: MetricDefinitionVersion): boolean {
  const hasGamificationConsumer = version.permittedConsumers.some((c) =>
    GAMIFICATION_CONSUMERS.has(c),
  )
  if (!hasGamificationConsumer) return false
  return version.sourcePolicyAllowlist.some((s) => GAMIFICATION_BLOCKED_SOURCES.has(s))
}
