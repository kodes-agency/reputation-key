// POST-BETA-3 PB3.1: Metric reading idempotency and correction model.
//
// Per ADR 0041:
// - Every reading carries a stable source_event_id for idempotency
//   and a definition_version_id for provenance.
// - Corrections are append-only; they never overwrite the original fact.
// - The registry fails closed: an unknown source/version produces no
//   reading. Invalid events are rejected explicitly.
import type { AttributionQuality } from './attribution-quality'
import type { SourcePolicyClass } from './metric-registry'
import type {
  MetricReadingId,
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
export type ReadingDataQuality = 'exact' | 'approximate' | 'delayed' | 'reconciling'
export type CorrectionKind = 'retract' | 'replace' | 'adjust'

export interface MetricReading {
  readonly id: MetricReadingId
  readonly definitionVersionId: string
  readonly metricKey: MetricKey
  readonly organizationId: OrganizationId
  readonly propertyId: PropertyId
  readonly portalGroupId: PortalGroupId | null
  readonly portalId: PortalId | null
  readonly value: number
  readonly numerator: number | null
  readonly denominator: number | null
  readonly duration: number | null
  readonly sampleCount: number
  readonly sourceEventId: string
  readonly sourcePolicy: SourcePolicyClass
  readonly occurredAt: Date
  readonly recordedAt: Date
  readonly propertyLocalDate: string
  readonly attributionQuality: AttributionQuality
  readonly dataQuality: ReadingDataQuality
  readonly retentionClass: string
  readonly staffAttribution: PrimaryStaffAttributionSnapshot | null
}

export interface MetricCorrection {
  readonly id: string
  readonly correctedReadingId: string
  readonly sourceEventId: string
  readonly kind: CorrectionKind
  readonly reason: string
  readonly actorType: string
  readonly actorId: string
  readonly exactDelta: number | null
  readonly replacementValue: number | null
  readonly occurredAt: Date
  readonly recordedAt: Date
  readonly supersedesCorrectionId: string | null
  readonly staffAttribution: PrimaryStaffAttributionSnapshot | null
}

export type ReadingResult =
  | { status: 'recorded'; reading: MetricReading }
  | { status: 'duplicate'; existingReadingId: string }
  | { status: 'rejected'; reason: string; sourceEventId: string }
  | {
      status: 'insufficient_data'
      definitionVersionId: string
      minimumSample: number
      actualSample: number
    }

/**
 * Create a new metric reading.
 *
 * Idempotency: the unique key is (definition_version_id, source_event_id, target_dimension).
 * If a reading with the same key already exists, it is a duplicate.
 */
export function createReading(params: {
  id: MetricReadingId
  definitionVersionId: string
  metricKey: MetricKey
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId?: PortalGroupId | null
  portalId?: PortalId | null
  value: number
  numerator?: number | null
  denominator?: number | null
  duration?: number | null
  sampleCount: number
  sourceEventId: string
  sourcePolicy: SourcePolicyClass
  occurredAt: Date
  propertyLocalDate: string
  attributionQuality: AttributionQuality
  dataQuality?: ReadingDataQuality
  retentionClass: string
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  now: Date
}): MetricReading {
  return {
    id: params.id,
    definitionVersionId: params.definitionVersionId,
    metricKey: params.metricKey,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalGroupId: params.portalGroupId ?? null,
    portalId: params.portalId ?? null,
    value: params.value,
    numerator: params.numerator ?? null,
    denominator: params.denominator ?? null,
    duration: params.duration ?? null,
    sampleCount: params.sampleCount,
    sourceEventId: params.sourceEventId,
    sourcePolicy: params.sourcePolicy,
    occurredAt: params.occurredAt,
    recordedAt: params.now,
    propertyLocalDate: params.propertyLocalDate,
    attributionQuality: params.attributionQuality,
    dataQuality: params.dataQuality ?? 'exact',
    retentionClass: params.retentionClass,
    staffAttribution: params.staffAttribution ?? null,
  }
}
/**
 * Check the immutable idempotency key (definition_version_id, source_event_id).
 */
export function findDuplicate(
  existing: readonly MetricReading[],
  definitionVersionId: string,
  sourceEventId: string,
): MetricReading | null {
  return (
    existing.find(
      (reading) =>
        reading.definitionVersionId === definitionVersionId &&
        reading.sourceEventId === sourceEventId,
    ) ?? null
  )
}

/**
 * Get the effective value of a reading after corrections.
 * Returns null for retracted readings.
 */
export function getEffectiveValue(
  reading: MetricReading,
  corrections: readonly MetricCorrection[],
): number | null {
  let latest: MetricCorrection | null = null

  for (const candidate of corrections) {
    if (candidate.correctedReadingId !== reading.id) continue

    let superseded = false
    for (const possibleSuccessor of corrections) {
      if (possibleSuccessor.supersedesCorrectionId === candidate.id) {
        superseded = true
        break
      }
    }
    if (superseded) continue

    if (
      latest === null ||
      candidate.recordedAt.getTime() > latest.recordedAt.getTime() ||
      (candidate.recordedAt.getTime() === latest.recordedAt.getTime() &&
        candidate.id > latest.id)
    ) {
      latest = candidate
    }
  }

  if (latest === null) return reading.value

  switch (latest.kind) {
    case 'retract':
      return null
    case 'replace':
      return latest.replacementValue
    case 'adjust':
      return latest.exactDelta === null
        ? reading.value
        : reading.value + latest.exactDelta
  }
}
