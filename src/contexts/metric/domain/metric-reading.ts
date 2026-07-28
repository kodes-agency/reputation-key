// POST-BETA-3 PB3.1: Metric reading idempotency and correction model.
//
// Per ADR 0041:
// - Every reading carries a stable source_event_id for idempotency
//   and a definition_version_id for provenance.
// - Corrections are append-only; they never overwrite the original fact.
// - The registry fails closed: an unknown source/version produces no
//   reading. Invalid events are quarantined.
import type { AttributionQuality } from './attribution-quality'

export type MetricValueKind = 'counter' | 'duration' | 'level' | 'ratio' | 'average'
export type ReadingDataQuality = 'exact' | 'approximate' | 'delayed' | 'reconciling'
export type CorrectionKind = 'retract' | 'replace' | 'adjust'

export interface MetricReading {
  readonly id: string
  readonly definitionVersionId: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalGroupId: string | null
  readonly portalId: string | null
  readonly value: number
  readonly numerator: number | null
  readonly denominator: number | null
  readonly duration: number | null
  readonly sampleSize: number
  readonly sourceEventId: string
  readonly sourceSchema: string
  readonly occurredAt: Date
  readonly recordedAt: Date
  readonly propertyLocalDate: string
  readonly attributionQuality: AttributionQuality
  readonly dataQuality: ReadingDataQuality
  readonly retentionClass: string
  readonly correctedBy: string | null
}

export interface MetricCorrection {
  readonly id: string
  readonly correctedReadingId: string
  readonly kind: CorrectionKind
  readonly reason: string
  readonly actor: string
  readonly replacementValue: number | null
  readonly occurredAt: Date
  readonly recordedAt: Date
  readonly supersededBy: string | null
}

export type ReadingResult =
  | { status: 'recorded'; reading: MetricReading }
  | { status: 'duplicate'; existingReadingId: string }
  | { status: 'quarantined'; reason: string; sourceEventId: string }
  | { status: 'rejected'; reason: string }

/**
 * Create a new metric reading.
 *
 * Idempotency: the unique key is (definition_version_id, source_event_id, target_dimension).
 * If a reading with the same key already exists, it is a duplicate.
 */
export function createReading(params: {
  id: string
  definitionVersionId: string
  organizationId: string
  propertyId: string
  portalGroupId?: string | null
  portalId?: string | null
  value: number
  numerator?: number | null
  denominator?: number | null
  duration?: number | null
  sampleSize: number
  sourceEventId: string
  sourceSchema: string
  occurredAt: Date
  propertyLocalDate: string
  attributionQuality: AttributionQuality
  dataQuality?: ReadingDataQuality
  retentionClass: string
  now: Date
}): MetricReading {
  return {
    id: params.id,
    definitionVersionId: params.definitionVersionId,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalGroupId: params.portalGroupId ?? null,
    portalId: params.portalId ?? null,
    value: params.value,
    numerator: params.numerator ?? null,
    denominator: params.denominator ?? null,
    duration: params.duration ?? null,
    sampleSize: params.sampleSize,
    sourceEventId: params.sourceEventId,
    sourceSchema: params.sourceSchema,
    occurredAt: params.occurredAt,
    recordedAt: params.now,
    propertyLocalDate: params.propertyLocalDate,
    attributionQuality: params.attributionQuality,
    dataQuality: params.dataQuality ?? 'exact',
    retentionClass: params.retentionClass,
    correctedBy: null,
  }
}

/**
 * Check if a reading is a duplicate of an existing one.
 * Idempotency key: (definition_version_id, source_event_id).
 * When portal_id is present, include it in the key.
 */
export function findDuplicate(
  existing: readonly MetricReading[],
  definitionVersionId: string,
  sourceEventId: string,
  portalId: string | null,
): MetricReading | null {
  return (
    existing.find(
      (r) =>
        r.definitionVersionId === definitionVersionId &&
        r.sourceEventId === sourceEventId &&
        (portalId === null ? r.portalId === null : r.portalId === portalId),
    ) ?? null
  )
}

/**
 * Apply a correction to a reading. Per ADR 0041: corrections are
 * append-only — they never overwrite the original fact.
 *
 * - 'retract': the reading is marked as retracted (value null in query results)
 * - 'replace': a new value replaces the old for query purposes
 * - 'adjust': the value is adjusted by a delta
 */
export function applyCorrection(
  reading: MetricReading,
  correction: MetricCorrection,
): MetricReading {
  return {
    ...reading,
    correctedBy: correction.id,
  }
}

/**
 * Get the effective value of a reading after corrections.
 * Returns null for retracted readings.
 */
export function getEffectiveValue(
  reading: MetricReading,
  corrections: readonly MetricCorrection[],
): number | null {
  if (reading.correctedBy === null) return reading.value

  // Find the latest correction chain
  const correction = corrections.find((c) => c.id === reading.correctedBy)
  if (!correction) return reading.value

  switch (correction.kind) {
    case 'retract':
      return null
    case 'replace':
      return correction.replacementValue
    case 'adjust':
      return correction.replacementValue !== null
        ? reading.value + correction.replacementValue
        : reading.value
  }
}
