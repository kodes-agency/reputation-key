import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type AiReviewEventDisposition =
  'pending' | 'source_expired' | 'provider_deleted' | 'policy_disabled'

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
  | Readonly<{ status: 'gap'; expectedSequence: number }>
  | Readonly<{ status: 'generation_changed' }>

export type AiReviewEventStorePort = Readonly<{
  consumeNext(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
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
      dispositionCode:
        | 'language_not_supported'
        | 'source_expired'
        | 'provider_deleted'
        | 'policy_disabled'
        | null
    }>,
  ): Promise<Readonly<{
    terminalAnalysisSequence: number
    aggregateRevision: number
  }> | null>
}>
