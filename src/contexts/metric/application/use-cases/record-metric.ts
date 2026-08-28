import { createHash } from 'node:crypto'
import type {
  MetricReadingId,
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { AttributionQuality } from '../../domain/attribution-quality'
import { metricRecorded } from '../../domain/events'
import {
  createReading,
  type ReadingDataQuality,
  type ReadingResult,
} from '../../domain/metric-reading'
import type { MetricScope, SourcePolicyClass } from '../../domain/metric-registry'
import type { MetricCommandStore } from '../ports/metric-command-store.port'
import type { MetricRegistryRepository } from '../ports/metric-registry.repository.port'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import {
  portalLifetimeFactForMetric,
  type PortalDestinationKind,
} from '../../domain/portal-lifetime-aggregate'

export type RecordMetricInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
  definitionVersionId: string
  sourceEventId: string
  /** Append-only source correction. The command store retracts this prior fact. */
  supersedesSourceEventId?: string | null
  sourcePolicy: SourcePolicyClass
  scope: MetricScope
  value: number
  numerator?: number | null
  denominator?: number | null
  duration?: number | null
  sampleCount: number
  occurredAt: Date
  attributionQuality: AttributionQuality
  dataQuality?: ReadingDataQuality
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  /** Required only for a qualified destination-selection fact. */
  destinationKind?: PortalDestinationKind | null
}>

export type RecordMetricDeps = Readonly<{
  commandStore: MetricCommandStore
  registry: MetricRegistryRepository
  clock: () => Date
  idGen: () => MetricReadingId
  resolvePropertyLocalDate: (propertyId: PropertyId, at: Date) => Promise<string>
}>

export type RecordMetric = (input: RecordMetricInput) => Promise<ReadingResult>

const payloadHash = (input: RecordMetricInput): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        definitionVersionId: input.definitionVersionId,
        sourceEventId: input.sourceEventId,
        supersedesSourceEventId: input.supersedesSourceEventId ?? null,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        portalId: input.portalId,
        portalGroupId: input.portalGroupId,
        scope: input.scope,
        value: input.value,
        numerator: input.numerator ?? null,
        denominator: input.denominator ?? null,
        sampleCount: input.sampleCount,
        occurredAt: input.occurredAt.toISOString(),
        staffAttribution: input.staffAttribution ?? null,
        destinationKind: input.destinationKind ?? null,
      }),
    )
    .digest('hex')
export const recordMetric =
  (deps: RecordMetricDeps): RecordMetric =>
  async (input) => {
    const governed = await deps.registry.findVersionById(input.definitionVersionId)

    const quarantine = async (reason: string): Promise<ReadingResult> => {
      await deps.commandStore.quarantine({
        sourceEventId: input.sourceEventId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        definitionVersionId: governed?.version.id ?? null,
        sourcePolicy: input.sourcePolicy,
        reason,
        payloadHash: payloadHash(input),
        eventAt: input.occurredAt,
      })
      return { status: 'quarantined', reason, sourceEventId: input.sourceEventId }
    }

    if (!governed) return quarantine('unknown_definition_version')

    const { definition, version } = governed
    if (definition.lifecycleStatus !== 'approved') {
      return quarantine('definition_not_approved')
    }
    if (
      input.occurredAt < version.effectiveFrom ||
      (version.effectiveTo !== null && input.occurredAt >= version.effectiveTo)
    ) {
      return quarantine('definition_version_not_effective')
    }
    if (!version.sourcePolicyAllowlist.includes(input.sourcePolicy)) {
      return quarantine('source_policy_not_allowed')
    }
    if (!version.allowedScopes.includes(input.scope)) {
      return quarantine('scope_not_allowed')
    }
    if (input.attributionQuality === 'unresolved') {
      return quarantine('unresolved_attribution')
    }
    if (
      input.sourceEventId.trim().length === 0 ||
      !Number.isFinite(input.value) ||
      input.value < 0 ||
      !Number.isInteger(input.sampleCount) ||
      input.sampleCount < 0
    ) {
      return quarantine('invalid_reading')
    }

    const numerator = input.numerator ?? null
    const denominator = input.denominator ?? null
    if (definition.valueKind === 'ratio' && input.sampleCount < version.minimumSample) {
      if (version.insufficientDataBehavior === 'quarantine') {
        return quarantine('insufficient_data')
      }
      return {
        status: 'insufficient_data',
        definitionVersionId: version.id,
        minimumSample: version.minimumSample,
        actualSample: input.sampleCount,
      }
    }

    if (
      definition.valueKind === 'ratio' &&
      (numerator === null || denominator === null || denominator <= 0)
    ) {
      return quarantine('invalid_ratio')
    }

    const reading = createReading({
      id: deps.idGen(),
      definitionVersionId: version.id,
      metricKey: definition.key,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      portalGroupId: input.portalGroupId,
      value: input.value,
      numerator,
      denominator,
      duration: input.duration,
      sampleCount: input.sampleCount,
      sourceEventId: input.sourceEventId,
      sourcePolicy: input.sourcePolicy,
      occurredAt: input.occurredAt,
      propertyLocalDate: await deps.resolvePropertyLocalDate(
        input.propertyId,
        input.occurredAt,
      ),
      attributionQuality: input.attributionQuality,
      dataQuality: input.dataQuality,
      retentionClass: definition.retentionClass,
      staffAttribution: input.staffAttribution ?? null,
      now: deps.clock(),
    })

    const portalLifetimeFact = portalLifetimeFactForMetric({
      metricKey: reading.metricKey,
      value: reading.value,
      destinationKind: input.destinationKind ?? null,
    })
    if (portalLifetimeFact && reading.portalId === null) {
      return quarantine('invalid_portal_lifetime_scope')
    }

    return deps.commandStore.recordMetric({
      reading,
      supersedesSourceEventId: input.supersedesSourceEventId ?? null,
      portalLifetimeFact,
      event: metricRecorded({
        readingId: reading.id,
        organizationId: reading.organizationId,
        propertyId: reading.propertyId,
        portalId: reading.portalId,
        portalGroupId: reading.portalGroupId,
        definitionVersionId: reading.definitionVersionId,
        sourceEventId: reading.sourceEventId,
        sourcePolicy: reading.sourcePolicy,
        metricKey: reading.metricKey,
        value: reading.value,
        numerator: reading.numerator,
        denominator: reading.denominator,
        sampleCount: reading.sampleCount,
        attributionQuality: reading.attributionQuality,
        permittedConsumers: version.permittedConsumers,
        occurredAt: reading.occurredAt,
        staffAttribution: reading.staffAttribution,
      }),
    })
  }
