// Readings retain source-event idempotency and definition-version provenance
// (ADR 0041). Corrections append without overwriting facts; unknown sources or
// versions fail closed and invalid events are explicitly rejected.

import type { AttributionQuality } from './attribution-quality'
import type { SourcePolicyClass } from '../readings/contracts'
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
  readonly portalLinkId: string | null
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

type DefaultedReadingFields =
  | 'portalGroupId'
  | 'portalId'
  | 'portalLinkId'
  | 'numerator'
  | 'denominator'
  | 'duration'
  | 'dataQuality'
  | 'staffAttribution'

type CreateReadingInput = Omit<MetricReading, DefaultedReadingFields | 'recordedAt'> &
  Partial<Pick<MetricReading, DefaultedReadingFields>> & { now: Date }

/** Source idempotency is enforced by the definition version and target dimension. */
export function createReading(params: CreateReadingInput): MetricReading {
  return {
    id: params.id,
    definitionVersionId: params.definitionVersionId,
    metricKey: params.metricKey,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalGroupId: params.portalGroupId ?? null,
    portalId: params.portalId ?? null,
    portalLinkId: params.portalLinkId ?? null,
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
