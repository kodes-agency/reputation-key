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

/** Immutable measurement policies shared by writers and readers. */
export const METRIC_DEFINITIONS = Object.freeze([
  seededEntry(
    {
      id: METRIC_DEFINITION_IDS.portalScan,
      key: 'portal.scan',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'solicitation_analytics',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.portalScanAnalytics,
        definitionId: METRIC_DEFINITION_IDS.portalScan,
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
      id: METRIC_DEFINITION_IDS.portalRating,
      key: 'portal.rating',
      valueKind: 'average',
      workerDataFlag: true,
      privacyClass: 'private_response_with_worker_link',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.portalRatingAnalytics,
        definitionId: METRIC_DEFINITION_IDS.portalRating,
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
      id: METRIC_DEFINITION_IDS.portalFeedback,
      key: 'portal.feedback',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'private_response',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.portalFeedbackAnalytics,
        definitionId: METRIC_DEFINITION_IDS.portalFeedback,
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
      id: METRIC_DEFINITION_IDS.portalDestinationClick,
      key: 'portal.review_link_click',
      valueKind: 'counter',
      workerDataFlag: false,
      privacyClass: 'solicitation_analytics',
      retentionClass: 'short',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
        definitionId: METRIC_DEFINITION_IDS.portalDestinationClick,
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
      id: METRIC_DEFINITION_IDS.propertyReview,
      key: 'property.review',
      valueKind: 'average',
      workerDataFlag: false,
      privacyClass: 'google_restricted',
      retentionClass: 'provider-aligned',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.propertyReviewDashboard,
        definitionId: METRIC_DEFINITION_IDS.propertyReview,
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
      id: METRIC_DEFINITION_IDS.qualifiedScan,
      key: 'portal.qualified_scan',
      valueKind: 'counter',
      workerDataFlag: true,
      privacyClass: 'guest_gateway_numeric_with_worker_link',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.qualifiedScanGoal,
        definitionId: METRIC_DEFINITION_IDS.qualifiedScan,
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
      id: METRIC_DEFINITION_IDS.portalRatingCount,
      key: 'portal.rating_count',
      valueKind: 'counter',
      workerDataFlag: true,
      privacyClass: 'guest_gateway_numeric_with_worker_link',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.portalRatingCountGoal,
        definitionId: METRIC_DEFINITION_IDS.portalRatingCount,
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
      id: METRIC_DEFINITION_IDS.portalRatingAverage,
      key: 'portal.rating_average',
      valueKind: 'average',
      workerDataFlag: true,
      privacyClass: 'guest_gateway_numeric_with_worker_link',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
    },
    [
      {
        id: METRIC_VERSION_IDS.portalRatingAverageGoal,
        definitionId: METRIC_DEFINITION_IDS.portalRatingAverage,
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

export type PortalDestinationKind = 'google_review' | 'secondary_link'

/** Validate the exact Guest fact shape before it can become a governed reading. */
export function validatePortalReading(
  input: Readonly<{
    metricKey: string
    value: number
    destinationKind?: PortalDestinationKind | null
  }>,
): boolean {
  const { metricKey, value, destinationKind } = input
  const invalid = () => {
    throw new Error('Portal metric fact is invalid')
  }
  switch (metricKey) {
    case 'portal.rating':
      if (!Number.isInteger(value) || value < 1 || value > 5 || destinationKind != null)
        invalid()
      return true
    case 'portal.qualified_scan':
    case 'portal.feedback':
      if (value !== 1 || destinationKind != null) invalid()
      return true
    case 'portal.review_link_click':
      if (
        value !== 1 ||
        (destinationKind !== 'google_review' && destinationKind !== 'secondary_link')
      )
        invalid()
      return true
    default:
      return false
  }
}
