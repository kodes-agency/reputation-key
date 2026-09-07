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
import type {
  GovernedMetricVersion,
  MetricScope,
  SourcePolicyClass,
} from '../../domain/metric-registry'
import type {
  MetricCommandStore,
  MetricSourceReceipt,
  RecordMetricEntry,
} from '../ports/metric-command-store.port'
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
  /** Source-consumer settlement committed atomically with the reading. */
  sourceReceipt?: MetricSourceReceipt
}>

export type RecordMetricDeps = Readonly<{
  commandStore: MetricCommandStore
  registry: MetricRegistryRepository
  clock: () => Date
  idGen: () => MetricReadingId
  resolvePropertyLocalDate: (
    propertyId: PropertyId,
    organizationId: OrganizationId,
    at: Date,
  ) => Promise<string>
}>

export type RecordMetric = (input: RecordMetricInput) => Promise<ReadingResult>

/**
 * Admission checks that reject a reading outright. Returns the rejection
 * reason, or null when the reading may proceed to value-shape checks.
 */
function rejectionReasonFor(
  input: RecordMetricInput,
  governed: GovernedMetricVersion,
): string | null {
  const { definition, version } = governed
  if (definition.lifecycleStatus !== 'approved') return 'definition_not_approved'
  if (
    input.occurredAt < version.effectiveFrom ||
    (version.effectiveTo !== null && input.occurredAt >= version.effectiveTo)
  ) {
    return 'definition_version_not_effective'
  }
  if (!version.sourcePolicyAllowlist.includes(input.sourcePolicy)) {
    return 'source_policy_not_allowed'
  }
  if (!version.allowedScopes.includes(input.scope)) return 'scope_not_allowed'
  if (input.attributionQuality === 'unresolved') return 'unresolved_attribution'
  if (
    input.sourceEventId.trim().length === 0 ||
    !Number.isFinite(input.value) ||
    input.value < 0 ||
    !Number.isInteger(input.sampleCount) ||
    input.sampleCount < 0
  ) {
    return 'invalid_reading'
  }
  return null
}

export type RecordMetricEntryInput = Omit<RecordMetricInput, 'sourceReceipt'>

export type RecordMetricsInput = Readonly<{
  readings: readonly RecordMetricEntryInput[]
  sourceReceipt?: MetricSourceReceipt
}>

export type RecordMetrics = (
  input: RecordMetricsInput,
) => Promise<readonly ReadingResult[]>

type BuiltMetricEntry =
  | Readonly<{ kind: 'entry'; entry: RecordMetricEntry }>
  | Readonly<{ kind: 'result'; result: ReadingResult }>

/**
 * Validate and materialize one reading without committing it. Fanout consumers
 * build every entry first, then hand the complete set to the atomic store.
 */
export async function buildRecordMetricEntry(
  deps: RecordMetricDeps,
  input: RecordMetricEntryInput,
): Promise<BuiltMetricEntry> {
  const governed = await deps.registry.findVersionById(input.definitionVersionId)

  const reject = (reason: string): BuiltMetricEntry => ({
    kind: 'result',
    result: {
      status: 'rejected',
      reason,
      sourceEventId: input.sourceEventId,
    },
  })

  if (!governed) return reject('unknown_definition_version')

  const { definition, version } = governed
  const admissionReason = rejectionReasonFor(input, governed)
  if (admissionReason !== null) return reject(admissionReason)

  const numerator = input.numerator ?? null
  const denominator = input.denominator ?? null
  if (definition.valueKind === 'ratio' && input.sampleCount < version.minimumSample) {
    if (version.insufficientDataBehavior === 'quarantine') {
      return reject('insufficient_data')
    }
    return {
      kind: 'result',
      result: {
        status: 'insufficient_data',
        definitionVersionId: version.id,
        minimumSample: version.minimumSample,
        actualSample: input.sampleCount,
      },
    }
  }

  if (
    definition.valueKind === 'ratio' &&
    (numerator === null || denominator === null || denominator <= 0)
  ) {
    return reject('invalid_ratio')
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
      input.organizationId,
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
    return reject('invalid_portal_lifetime_scope')
  }

  return {
    kind: 'entry',
    entry: {
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
    },
  }
}

export const recordMetrics =
  (deps: RecordMetricDeps): RecordMetrics =>
  async (input) => {
    const entries: RecordMetricEntry[] = []
    for (const reading of input.readings) {
      const built = await buildRecordMetricEntry(deps, reading)
      if (built.kind === 'result') {
        if (input.readings.length === 1) return [built.result]
        throw new Error(`Metric batch entry was not recordable: ${built.result.status}`)
      }
      entries.push(built.entry)
    }
    return deps.commandStore.recordMetrics({
      readings: entries,
      sourceReceipt: input.sourceReceipt,
    })
  }

export const recordMetric = (deps: RecordMetricDeps): RecordMetric => {
  const recordBatch = recordMetrics(deps)
  return async (input) => {
    const { sourceReceipt, ...reading } = input
    const [result] = await recordBatch({
      readings: [reading],
      sourceReceipt,
    })
    if (!result) throw new Error('Metric command produced no result')
    return result
  }
}
