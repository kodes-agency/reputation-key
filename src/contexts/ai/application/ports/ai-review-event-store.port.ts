import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type AiReviewEventDisposition =
  'pending' | 'source_expired' | 'provider_deleted' | 'policy_disabled'

export type AiReviewAnalysisTerminalDisposition =
  | Exclude<AiReviewEventDisposition, 'pending'>
  | 'language_not_supported'
  | 'operation_abandoned'
  | 'operation_ambiguous'

export type AiReviewEventConsumeResult =
  | Readonly<{
      status: 'accepted'
      consumedSequence: number
      terminalAnalysisSequence: number
    }>
  | Readonly<{
      status: 'duplicate'
      consumedSequence: number
      terminalAnalysisSequence: number
    }>
  | Readonly<{ status: 'generation_changed' }>

export type AiReviewEventStorePort = Readonly<{
  consumeNext(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      analysisStartSequence: number
      analysisSequence: number
      eventEnvelopeId: string
      disposition: AiReviewEventDisposition
    }>,
  ): Promise<AiReviewEventConsumeResult>
  settleOutcome(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
      analysisSequence: number
      state: 'ready' | 'terminal_no_result'
      operationId: string | null
      dispositionCode: AiReviewAnalysisTerminalDisposition | null
    }>,
  ): Promise<Readonly<{
    terminalAnalysisSequence: number
    aggregateRevision: number
  }> | null>
}>
