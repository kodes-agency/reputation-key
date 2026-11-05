// The registry is the authority for governed measurements (ADR 0041).
// Callers reference immutable version ids; material rule changes need a new version.
// Unknown sources/versions fail closed. Employment-decision eligibility stays false.

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
  | 'recognition'
  | 'notification'
  | 'export'
  | 'portal_analytics'
  | 'staff_self'

export type InsufficientDataBehavior = 'unavailable' | 'quarantine'

export interface MetricDefinition {
  readonly id: string
  readonly key: MetricKey
  readonly valueKind: MetricValueKind
  readonly workerDataFlag: boolean
  readonly privacyClass: string
  readonly retentionClass: string
  readonly lifecycleStatus: MetricLifecycleStatus
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
  readonly unit: string
  readonly precision: number
  readonly allowedScopes: readonly MetricScope[]
  readonly minimumSample: number
  readonly insufficientDataBehavior: InsufficientDataBehavior
  readonly sourcePolicyAllowlist: readonly SourcePolicyClass[]
  readonly permittedConsumers: readonly PermittedConsumer[]
  readonly employmentDecisionEligible: false
}

export interface SeededMetricRegistryEntry {
  readonly definition: MetricDefinition
  readonly versions: readonly MetricDefinitionVersion[]
}

/** Stable IDs in the code-reviewed catalogue; producers never select by mutable key. */
export const METRIC_VERSION_IDS = {
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
  definition: MetricDefinition,
  versions: readonly MetricDefinitionVersion[],
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
      id: '11111111-1111-4111-8111-111111110201',
      key: 'portal.scan',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'solicitation_analytics',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111201',
        definitionId: '11111111-1111-4111-8111-111111110201',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        unit: 'scan',
        precision: 0,
        allowedScopes: ['property', 'portal', 'portal_group'],
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['review_solicitation_analytics_only'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110202',
      key: 'portal.rating',
      valueKind: 'average',
      workerDataFlag: true,
      privacyClass: 'private_response_with_worker_link',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111202',
        definitionId: '11111111-1111-4111-8111-111111110202',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        unit: 'rating',
        precision: 2,
        allowedScopes: ['property', 'portal_group', 'portal'],
        minimumSample: 5,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_private'],
        permittedConsumers: ['portal_analytics', 'staff_self'],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110203',
      key: 'portal.feedback',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'private_response',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111203',
        definitionId: '11111111-1111-4111-8111-111111110203',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        unit: 'response',
        precision: 0,
        allowedScopes: ['property', 'portal_group', 'portal'],
        minimumSample: 5,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_private'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110204',
      key: 'portal.review_link_click',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'solicitation_analytics',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111204',
        definitionId: '11111111-1111-4111-8111-111111110204',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        unit: 'click',
        precision: 0,
        allowedScopes: ['property', 'portal_group', 'portal'],
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['review_solicitation_analytics_only'],
        permittedConsumers: ['portal_analytics'],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110205',
      key: 'property.review',
      valueKind: 'average',
      workerDataFlag: false,
      privacyClass: 'google_restricted',
      retentionClass: 'provider-aligned',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111205',
        definitionId: '11111111-1111-4111-8111-111111110205',
        version: 1,
        effectiveFrom: new Date('2026-08-08T03:00:00+0300'),
        effectiveTo: null,
        unit: 'rating',
        precision: 2,
        allowedScopes: ['property'],
        minimumSample: 1,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['google_property_derivative'],
        permittedConsumers: ['dashboard'],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110301',
      key: 'portal.qualified_scan',
      valueKind: 'counter',
      workerDataFlag: true,
      privacyClass: 'guest_gateway_numeric_with_worker_link',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111301',
        definitionId: '11111111-1111-4111-8111-111111110301',
        version: 1,
        effectiveFrom: new Date('2026-08-01T03:00:00+0300'),
        effectiveTo: null,
        unit: 'scan',
        precision: 0,
        allowedScopes: ['property', 'portal_group', 'portal'],
        minimumSample: 0,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
          'staff_self',
        ],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110302',
      key: 'portal.rating_count',
      valueKind: 'counter',
      workerDataFlag: true,
      privacyClass: 'guest_gateway_numeric_with_worker_link',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111302',
        definitionId: '11111111-1111-4111-8111-111111110302',
        version: 1,
        effectiveFrom: new Date('2026-08-01T03:00:00+0300'),
        effectiveTo: null,
        unit: 'rating',
        precision: 0,
        allowedScopes: ['property', 'portal_group', 'portal'],
        minimumSample: 0,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
          'staff_self',
        ],
        employmentDecisionEligible: false,
      },
    ],
  ),
  seededEntry(
    {
      id: '11111111-1111-4111-8111-111111110303',
      key: 'portal.rating_average',
      valueKind: 'average',
      workerDataFlag: true,
      privacyClass: 'guest_gateway_numeric_with_worker_link',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: '11111111-1111-4111-8111-111111111303',
        definitionId: '11111111-1111-4111-8111-111111110303',
        version: 1,
        effectiveFrom: new Date('2026-08-01T03:00:00+0300'),
        effectiveTo: null,
        unit: 'star',
        precision: 1,
        allowedScopes: ['property', 'portal_group', 'portal'],
        minimumSample: 10,
        insufficientDataBehavior: 'unavailable',
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
          'staff_self',
        ],
        employmentDecisionEligible: false,
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

export function findMetricVersionById(versionId: string): GovernedMetricVersion | null {
  return METRIC_VERSIONS_BY_ID[versionId] ?? null
}
