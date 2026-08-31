import type { IntegrationGoogleReviewPushAccepted } from '../../domain/events'

export type GbpReviewPushReceiptOutcome =
  | 'accepted_targeted'
  | 'accepted_reconciliation'
  | 'ignored_property_not_found'
  | 'ignored_binding_mismatch'

export type GbpReviewPushReceiptStore = Readonly<{
  record(
    input: Readonly<{
      topic: string
      messageId: string
      receivedAt: Date
      acceptedAt: Date
      notificationKind: string
      resolvedPropertyId: string | null
      outcome: GbpReviewPushReceiptOutcome
      event: IntegrationGoogleReviewPushAccepted | null
    }>,
  ): Promise<Readonly<{ status: 'recorded' | 'duplicate' }>>
}>
