import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type AiReviewSource = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  reviewedAtEpochMillis: number
  canonicalSourceBytes: Uint8Array
  canonicalSourceDigest: string
  subjectHmac: string
  subjectHmacKeyVersion: string
}>

export type AiTrendAggregateSource = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  dueLocalDate: string
  terminalAnalysisSequence: number
  aggregateRevision: number
  selectedAggregateJson: Readonly<Record<string, unknown>>
}>

export type AiSourcePort = Readonly<{
  readReviewSource(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      expectedSourceEpoch: number
      expectedSourceRevision: number
      expectedAnalysisSequence: number
    }>,
  ): Promise<AiReviewSource | null>

  readTrendAggregate(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      expectedSourceEpoch: number
      dueLocalDate: string
      expectedTerminalAnalysisSequence: number
      expectedAggregateRevision: number
    }>,
  ): Promise<AiTrendAggregateSource | null>
}>
