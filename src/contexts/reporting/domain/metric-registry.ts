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

import type { MetricKey } from '#/shared/domain/metric-keys'
export type MetricValueKind = 'counter' | 'duration' | 'level' | 'ratio' | 'average'
export type MetricLifecycleStatus = 'draft' | 'approved' | 'retired'
export type SourcePolicyClass =
  | 'google_property_derivative'
  | 'review_solicitation_analytics_only'
  | 'first_party_guest_private'
  | 'first_party_guest_gateway_metric'
  | 'first_party_workflow'
  | 'manager_confirmed_recognition'
export type MetricScope = 'property' | 'portal_group' | 'portal'
export type PermittedConsumer =
  | 'dashboard'
  | 'goal'
  | 'badge'
  | 'leaderboard'
  | 'recognition'
  | 'notification'
  | 'export'
  | 'portal_analytics'

export type InsufficientDataBehavior = 'unavailable' | 'quarantine'

export interface MetricDefinition {
  readonly id: string
  readonly key: MetricKey
  readonly name: string
  readonly description: string
  readonly valueKind: MetricValueKind
  readonly workerDataFlag: boolean
  readonly privacyClass: string
  readonly retentionClass: string
  readonly lifecycleStatus: MetricLifecycleStatus
  readonly approvalOwner: string
}
export interface SeededMetricDefinition extends MetricDefinition {
  readonly entityLevel: 'property' | 'portal'
  readonly valueType: MetricValueKind
  readonly createdAt: string
}

export type GovernedMetricVersion = Readonly<{
  definition: MetricDefinition
  version: MetricDefinitionVersion
}>

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
export interface SeededMetricDefinitionVersion extends MetricDefinitionVersion {
  readonly createdAt: string
}

export interface SeededMetricRegistryEntry {
  readonly definition: SeededMetricDefinition
  readonly versions: readonly SeededMetricDefinitionVersion[]
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
  asOf: Date,
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
  'first_party_guest_private',
])

const GAMIFICATION_CONSUMERS: ReadonlySet<PermittedConsumer> = new Set(['goal'])

export function isGamificationViolation(version: MetricDefinitionVersion): boolean {
  const hasGamificationConsumer = version.permittedConsumers.some((c) =>
    GAMIFICATION_CONSUMERS.has(c),
  )
  if (!hasGamificationConsumer) return false
  return version.sourcePolicyAllowlist.some((s) => GAMIFICATION_BLOCKED_SOURCES.has(s))
}

/** Stable IDs in the code-reviewed catalogue; producers never select by mutable key. */
export const METRIC_VERSION_IDS = {
  contentReviewCompleted: '11111111-1111-4111-8111-111111111101',
  configurationCompleteness: '11111111-1111-4111-8111-111111111102',
  approvedDestinationRatio: '11111111-1111-4111-8111-111111111103',
  portalScanAnalytics: '11111111-1111-4111-8111-111111111201',
  portalRatingAnalytics: '11111111-1111-4111-8111-111111111202',
  portalFeedbackAnalytics: '11111111-1111-4111-8111-111111111203',
  portalDestinationClickAnalytics: '11111111-1111-4111-8111-111111111204',
  propertyReviewDashboard: '11111111-1111-4111-8111-111111111205',
  qualifiedScanGoal: '11111111-1111-4111-8111-111111111301',
  portalRatingCountGoal: '11111111-1111-4111-8111-111111111302',
  portalRatingAverageGoal: '11111111-1111-4111-8111-111111111303',
} as const
export const METRIC_DEFINITION_IDS = {
  contentReviewCompleted: '11111111-1111-4111-8111-111111110101',
  configurationCompleteness: '11111111-1111-4111-8111-111111110102',
  approvedDestinationRatio: '11111111-1111-4111-8111-111111110103',
  portalScan: '11111111-1111-4111-8111-111111110201',
  portalRating: '11111111-1111-4111-8111-111111110202',
  portalFeedback: '11111111-1111-4111-8111-111111110203',
  portalDestinationClick: '11111111-1111-4111-8111-111111110204',
  propertyReview: '11111111-1111-4111-8111-111111110205',
  qualifiedScan: '11111111-1111-4111-8111-111111110301',
  portalRatingCount: '11111111-1111-4111-8111-111111110302',
  portalRatingAverage: '11111111-1111-4111-8111-111111110303',
} as const

function seededEntry(
  definition: SeededMetricDefinition,
  versions: readonly SeededMetricDefinitionVersion[],
): SeededMetricRegistryEntry {
  const frozenVersions = versions.map((version) =>
    Object.freeze({
      ...version,
      allowedScopes: Object.freeze([...version.allowedScopes]),
      sourcePolicyAllowlist: Object.freeze([...version.sourcePolicyAllowlist]),
      permittedConsumers: Object.freeze([...version.permittedConsumers]),
    }),
  )

  return Object.freeze({
    definition: Object.freeze({ ...definition }),
    versions: Object.freeze(frozenVersions),
  })
}

/** Code-reviewed catalogue replacing the former database registry. */
export const METRIC_DEFINITIONS = Object.freeze([
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110101',
      key: 'portal.content_review.completed',
      name: 'Portal content reviews completed',
      entityLevel: 'property',
      valueType: 'counter',
      description:
        'Explicit manager confirmation that published Portal content was reviewed.',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'operational',
      retentionClass: 'standard',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111101',
        definitionId: '11111111-1111-4111-8111-111111110101',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Explicit manager content-reviewed action',
        denominatorDescription: null,
        unit: 'review',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal_group'],
        attributionRule: 'property and effective Portal group at event time',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['dashboard', 'goal', 'badge', 'leaderboard', 'notification'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
      {
        id: '11111111-1111-4111-8111-111111112101',
        definitionId: '11111111-1111-4111-8111-111111110101',
        version: 2,
        effectiveFrom: new Date('2026-08-09T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Explicit manager content-reviewed action',
        denominatorDescription: null,
        unit: 'review',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal_group'],
        attributionRule: 'property and effective Portal group at event time',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['dashboard', 'goal', 'recognition', 'notification'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110102',
      key: 'portal.configuration_completeness',
      name: 'Portal configuration completeness',
      entityLevel: 'property',
      valueType: 'level',
      description: 'Published required configuration fields completed as a percentage.',
      valueKind: 'level',
      workerDataFlag: false,
      privacyClass: 'operational',
      retentionClass: 'standard',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111102',
        definitionId: '11111111-1111-4111-8111-111111110102',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Published required fields present',
        denominatorDescription: 'Published required fields configured',
        unit: 'percent',
        precision: 2,
        aggregationRule: 'latest',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal_group'],
        attributionRule: 'property and effective Portal group at event time',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['dashboard', 'goal', 'badge', 'leaderboard', 'notification'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
      {
        id: '11111111-1111-4111-8111-111111112102',
        definitionId: '11111111-1111-4111-8111-111111110102',
        version: 2,
        effectiveFrom: new Date('2026-08-09T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Published required fields present',
        denominatorDescription: 'Published required fields configured',
        unit: 'percent',
        precision: 2,
        aggregationRule: 'latest',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal_group'],
        attributionRule: 'property and effective Portal group at event time',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['dashboard', 'goal', 'recognition', 'notification'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110103',
      key: 'portal.approved_destination_ratio',
      name: 'Approved Portal destination ratio',
      entityLevel: 'property',
      valueType: 'ratio',
      description: 'Approved destinations divided by configured destinations.',
      valueKind: 'ratio',
      workerDataFlag: false,
      privacyClass: 'operational',
      retentionClass: 'standard',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111103',
        definitionId: '11111111-1111-4111-8111-111111110103',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Approved published destinations',
        denominatorDescription: 'Configured published destinations',
        unit: 'ratio',
        precision: 4,
        aggregationRule: 'latest',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal_group'],
        attributionRule: 'property and effective Portal group at event time',
        minimumSample: 5,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['dashboard', 'goal', 'badge', 'leaderboard', 'notification'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
      {
        id: '11111111-1111-4111-8111-111111112103',
        definitionId: '11111111-1111-4111-8111-111111110103',
        version: 2,
        effectiveFrom: new Date('2026-08-09T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Approved published destinations',
        denominatorDescription: 'Configured published destinations',
        unit: 'ratio',
        precision: 4,
        aggregationRule: 'ratio',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal_group'],
        attributionRule: 'property and effective Portal group at event time',
        minimumSample: 5,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_workflow'],
        permittedConsumers: ['dashboard', 'goal', 'recognition', 'notification'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110201',
      key: 'portal.scan',
      name: 'Portal scans',
      entityLevel: 'portal',
      valueType: 'counter',
      description: 'Portal scan operational analytics only.',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'solicitation_analytics',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111201',
        definitionId: '11111111-1111-4111-8111-111111110201',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Portal scans',
        denominatorDescription: null,
        unit: 'scan',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property', 'portal', 'portal_group'],
        attributionRule: 'portal and property at event time',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['review_solicitation_analytics_only'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110202',
      key: 'portal.rating',
      name: 'Private Portal ratings',
      entityLevel: 'portal',
      valueType: 'average',
      description: 'Private guest rating aggregate for Portal analytics only.',
      valueKind: 'average',
      workerDataFlag: false,
      privacyClass: 'private_response',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
      approvalOwner: 'privacy',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111202',
        definitionId: '11111111-1111-4111-8111-111111110202',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Private rating total',
        denominatorDescription: 'Private rating response count',
        unit: 'rating',
        precision: 2,
        aggregationRule: 'average',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['portal'],
        attributionRule: 'portal at response time',
        minimumSample: 5,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_private'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110203',
      key: 'portal.feedback',
      name: 'Private Portal feedback count',
      entityLevel: 'portal',
      valueType: 'counter',
      description:
        'Private guest response count for Portal analytics only; no response content.',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'private_response',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
      approvalOwner: 'privacy',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111203',
        definitionId: '11111111-1111-4111-8111-111111110203',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Private responses received',
        denominatorDescription: null,
        unit: 'response',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['portal'],
        attributionRule: 'portal at response time',
        minimumSample: 5,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_private'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110204',
      key: 'portal.review_link_click',
      name: 'Portal destination clicks',
      entityLevel: 'portal',
      valueType: 'counter',
      description: 'Portal destination click operational analytics only.',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'solicitation_analytics',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111204',
        definitionId: '11111111-1111-4111-8111-111111110204',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Published destination clicks',
        denominatorDescription: null,
        unit: 'click',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['portal'],
        attributionRule: 'portal at click time',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['review_solicitation_analytics_only'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110205',
      key: 'property.review',
      name: 'Imported property reviews',
      entityLevel: 'property',
      valueType: 'average',
      description:
        'Imported Google review aggregate for governed property Dashboard use only.',
      valueKind: 'average',
      workerDataFlag: false,
      privacyClass: 'google_restricted',
      retentionClass: 'provider-aligned',
      lifecycleStatus: 'approved',
      approvalOwner: 'privacy',
      createdAt: '2026-09-05 23:07:05.116845+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111205',
        definitionId: '11111111-1111-4111-8111-111111110205',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Imported review rating total',
        denominatorDescription: 'Imported review count',
        unit: 'rating',
        precision: 2,
        aggregationRule: 'average',
        lateArrivalRule: 'accept_with_source_event_time',
        allowedScopes: ['property'],
        attributionRule: 'source property identity',
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['google_property_derivative'],
        permittedConsumers: ['dashboard'],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_for_consumers',
        createdAt: '2026-09-05 23:07:05.116845+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110301',
      key: 'portal.qualified_scan',
      name: 'Qualified scans',
      entityLevel: 'portal',
      valueType: 'counter',
      description:
        'Server-verified QR or NFC Access Artifact arrivals, deduplicated per response session and Portal over 24 hours.',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'deidentified_guest_gateway_numeric',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.351486+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111301',
        definitionId: '11111111-1111-4111-8111-111111110301',
        version: 1,
        effectiveFrom: new Date('2026-08-01T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription:
          'Eligible server-verified and session-deduplicated Access Artifact arrivals',
        denominatorDescription: null,
        unit: 'scan',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'append_by_source_event_time_reconcile_24h_after_month_end',
        allowedScopes: ['property', 'portal_group', 'portal'],
        attributionRule:
          'property, Portal, and effective Portal Group at source-event time',
        minimumSample: 0,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
        ],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_manager_context',
        createdAt: '2026-09-05 23:07:05.351486+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110302',
      key: 'portal.rating_count',
      name: 'Portal rating count',
      entityLevel: 'portal',
      valueType: 'counter',
      description:
        'Count of eligible first-party private numeric Portal ratings from every arrival channel.',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'deidentified_guest_gateway_numeric',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.351486+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111302',
        definitionId: '11111111-1111-4111-8111-111111110302',
        version: 1,
        effectiveFrom: new Date('2026-08-01T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Eligible private numeric Portal ratings',
        denominatorDescription: null,
        unit: 'rating',
        precision: 0,
        aggregationRule: 'sum',
        lateArrivalRule: 'append_by_source_event_time_reconcile_24h_after_month_end',
        allowedScopes: ['property', 'portal_group', 'portal'],
        attributionRule:
          'property, Portal, and effective Portal Group at source-event time',
        minimumSample: 0,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
        ],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_manager_context',
        createdAt: '2026-09-05 23:07:05.351486+03',
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110303',
      key: 'portal.rating_average',
      name: 'Portal rating average',
      entityLevel: 'portal',
      valueType: 'average',
      description:
        'Rating-weighted average of eligible first-party private numeric Portal ratings from every arrival channel.',
      valueKind: 'average',
      workerDataFlag: false,
      privacyClass: 'deidentified_guest_gateway_numeric',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
      approvalOwner: 'product-governance',
      createdAt: '2026-09-05 23:07:05.351486+03',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111303',
        definitionId: '11111111-1111-4111-8111-111111110303',
        version: 1,
        effectiveFrom: new Date('2026-08-01T03:00:00+0300'),
        effectiveTo: null,
        numeratorDescription: 'Sum of eligible private numeric Portal rating values',
        denominatorDescription: 'Count of eligible private numeric Portal ratings',
        unit: 'star',
        precision: 1,
        aggregationRule: 'weighted_average',
        lateArrivalRule: 'append_by_source_event_time_reconcile_24h_after_month_end',
        allowedScopes: ['property', 'portal_group', 'portal'],
        attributionRule:
          'property, Portal, and effective Portal Group at source-event time',
        minimumSample: 10,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
        ],
        employmentDecisionEligible: false,
        correctionBehavior: 'append_delta',
        fairnessReviewStatus: 'approved_manager_context',
        createdAt: '2026-09-05 23:07:05.351486+03',
      },
    ],
  ),
])

const metricVersionsById: Record<string, GovernedMetricVersion> = {}
for (const entry of METRIC_DEFINITIONS) {
  for (const version of entry.versions) {
    metricVersionsById[version.id] = Object.freeze({
      definition: entry.definition,
      version,
    })
  }
}
const METRIC_VERSIONS_BY_ID = Object.freeze(metricVersionsById)

export function findMetricDefinition(
  metricKey: MetricKey,
): SeededMetricRegistryEntry | null {
  return METRIC_DEFINITIONS.find(({ definition }) => definition.key === metricKey) ?? null
}

export function findMetricVersionById(versionId: string): GovernedMetricVersion | null {
  return METRIC_VERSIONS_BY_ID[versionId] ?? null
}

export const BETA_SAFE_METRIC_VERSION_IDS = [
  METRIC_VERSION_IDS.qualifiedScanGoal,
  METRIC_VERSION_IDS.portalRatingCountGoal,
  METRIC_VERSION_IDS.portalRatingAverageGoal,
] as const
