import type { IntegrationGoogleReviewPushAccepted } from '../../domain/events'

export type GbpReviewPushReceiptOutcome =
  | 'accepted_targeted'
  | 'accepted_reconciliation'
  | 'ignored_property_not_found'
  | 'ignored_binding_mismatch'

/** What one push meant for one Property (or for none: `resolvedPropertyId` null). */
export type GbpReviewPushDelivery = Readonly<{
  resolvedPropertyId: string | null
  outcome: GbpReviewPushReceiptOutcome
  event: IntegrationGoogleReviewPushAccepted | null
}>

export type GbpReviewPushReceiptStore = Readonly<{
  /**
   * One transaction: the message's receipt wins dedupe, and every delivery's
   * receipt and handoff fact commit with it, or nothing does.
   *
   * A push is usually for one Property. It is for several when Organizations
   * hold the same Google location through the same account, and then each
   * Property gets a receipt row and a fact of its own.
   */
  record(
    input: Readonly<{
      topic: string
      messageId: string
      receivedAt: Date
      acceptedAt: Date
      notificationKind: string
      deliveries: readonly [GbpReviewPushDelivery, ...GbpReviewPushDelivery[]]
    }>,
  ): Promise<Readonly<{ status: 'recorded' | 'duplicate' }>>
}>
