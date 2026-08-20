import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type AiPropertyAggregateHead = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  aggregateRevision: number
  terminalAnalysisSequence: number
}>

export type AiPropertyDailyAggregate = Readonly<{
  localDate: string
  reviewCount: number
  ratingSum: number
  sentimentCounts: Readonly<{
    positive: number
    neutral: number
    negative: number
    mixed: number
  }>
  categoryCounts: Readonly<{
    service: number
    staff: number
    quality: number
    value: number
    cleanliness: number
    wait_time: number
    atmosphere: number
    location: number
    accessibility: number
    other: number
  }>
  attentionCounts: Readonly<{
    urgent: number
    high: number
    medium: number
    low: number
  }>
}>

export type AiPropertyAggregateStorePort = Readonly<{
  applyReviewAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      calendarProfileVersion: 'property-calendar-v1'
    }>,
  ): Promise<
    | Readonly<{ status: 'applied'; aggregateRevision: number }>
    | Readonly<{ status: 'replayed'; aggregateRevision: number }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'stale' }>
    | Readonly<{ status: 'gap'; expectedAnalysisSequence: number }>
  >
  advanceWithoutAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      analysisSequence: number
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      dispositionCode:
        | 'source_expired'
        | 'provider_deleted'
        | 'policy_disabled'
        | 'language_not_supported'
    }>,
  ): Promise<
    | Readonly<{ status: 'applied'; aggregateRevision: number }>
    | Readonly<{ status: 'replayed'; aggregateRevision: number }>
    | Readonly<{ status: 'stale' }>
    | Readonly<{ status: 'gap'; expectedAnalysisSequence: number }>
  >
  readWindow(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      startLocalDate: string
      endLocalDate: string
    }>,
  ): Promise<Readonly<{
    head: AiPropertyAggregateHead
    days: readonly AiPropertyDailyAggregate[]
  }> | null>
}>
