import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AiReviewAnalysisTerminalDisposition } from './ai-review-event-store.port.server'

export type AiPropertyAggregateHead = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  aggregateRevision: number
  terminalAnalysisSequence: number
}>

export type AiPropertyAggregateCoverage = Readonly<{
  /** Exact append-only settlement ledger rows for this source and analysis epoch. */
  settledAnalysisCount: number
  /** Review Analysis head minus the enablement start sequence. */
  expectedAnalysisCount: number
  /** Expected settlements that have not reached the aggregate ledger yet. */
  awaitingAnalysisCount: number
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
    }>,
  ): Promise<
    | Readonly<{ status: 'applied'; aggregateRevision: number }>
    | Readonly<{ status: 'replayed'; aggregateRevision: number }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'stale' }>
  >
  advanceWithoutAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      reviewId: ReviewId
      analysisSequence: number
      reviewAnalysisEpoch: number
      propertyProfileVersion: number
      dispositionCode: AiReviewAnalysisTerminalDisposition
    }>,
  ): Promise<
    | Readonly<{ status: 'applied'; aggregateRevision: number }>
    | Readonly<{ status: 'replayed'; aggregateRevision: number }>
    | Readonly<{ status: 'stale' }>
  >
}>
