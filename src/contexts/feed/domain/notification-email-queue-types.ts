// Feed notification surface — the shapes the email queue, its suppression
// list and the digest batches read and write.

import type { DeliveryErrorClass } from './notification-types'
import type {
  NotificationDigestBatchId,
  NotificationEmailId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'

/** An (organization, user) pair that has at least one due queue row. */
export type NotificationEmailRecipient = Readonly<{
  organizationId: OrganizationId
  userId: UserId
}>

/**
 * One queue row moved by a provider webhook event. Returned so the caller can
 * cascade a terminal negative state (bounced/complained) onto the recipient's
 * remaining queued mail without a second lookup.
 */
export type ProviderStateTransition = Readonly<{
  emailId: NotificationEmailId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId | null
}>

/**
 * What the provider reports about a message after accepting it (ADR 0046 r.6).
 * `delivery_delayed` is the provider still trying; it is recorded but leaves
 * the message in flight, unlike the queue's own pre-send `delayed`.
 */
export type ProviderDeliveryState =
  'delivered' | 'delivery_delayed' | 'bounced' | 'complained' | 'failed' | 'suppressed'

/** Why the provider refused an address for good. */
export type EmailSuppressionReason = 'bounced' | 'complained' | 'suppressed'

export type NotificationDigestBatchState =
  'prepared' | 'retryable' | 'accepted' | 'terminal'

/**
 * The exact provider request a batch was frozen with, minus its idempotency
 * key. A retry of a batch the provider may already hold re-sends this rather
 * than a fresh render: a repeat event coalescing into a line changes the
 * rendered wording, and different content under the same key is refused.
 */
export type FrozenDigestRequest = Readonly<{
  to: string
  subject: string
  html: string
  text: string
  headers: Readonly<Record<string, string>>
}>

export type NotificationDigestBatch = Readonly<{
  id: NotificationDigestBatchId
  organizationId: OrganizationId
  userId: UserId
  localDate: string
  sequence: number
  memberDigest: string
  contentDigest: string
  providerIdempotencyKey: string
  unsubscribeKeyVersion: string
  state: NotificationDigestBatchState
  retryCount: number
  /**
   * A retryable batch the provider refused on every attempt, before accepting
   * anything: its idempotency key protects no delivered mail, so it may be
   * re-keyed. False once any attempt may have been accepted, including one
   * whose worker never reported back.
   */
  everyAttemptRefused: boolean
  /**
   * When the first attempt the provider may have accepted started: its
   * 24-hour idempotency window opens there, so a retry is safe only for a
   * bounded time after it. `null` while no attempt has started, or the
   * provider refused every one.
   */
  possiblyAcceptedSince: Date | null
  /**
   * Kept only while the batch is open, and `null` for a batch frozen before
   * requests were stored: such a batch is re-rendered and compared instead.
   */
  providerRequest: FrozenDigestRequest | null
  createdAt: Date
  updatedAt: Date
}>

export type PreparedNotificationDigestBatch = Readonly<{
  batch: NotificationDigestBatch
  created: boolean
}>

export type DigestBatchSettlement =
  | Readonly<{
      kind: 'accepted'
      providerMessageId: string
      acceptedAt: Date
    }>
  | Readonly<{
      kind: 'rejected'
      classification: DeliveryErrorClass
      nextAttemptAt: Date | null
      failedAt: Date
      /** The provider answered before accepting anything (a rate limit, say). */
      refusedBeforeAcceptance: boolean
    }>
  | Readonly<{
      kind: 'content_mismatch'
      detectedAt: Date
    }>
  | Readonly<{
      /**
       * Retire a batch whose content has changed since it was frozen, and free
       * its members for a fresh batch under a new key. Refused unless the
       * batch really is `everyAttemptRefused`.
       */
      kind: 'superseded'
      detectedAt: Date
    }>
  | Readonly<{
      kind: 'invalidated'
      reason: string
      invalidatedAt: Date
    }>

/**
 * The server secret refused addresses are keyed with, and the keys entries may
 * still be stored under while they move. Without a current key the suppression
 * functions throw rather than guess.
 */
export type EmailAddressKeys = Readonly<{
  emailAddressKey?: string
  retiredEmailAddressKeys?: readonly string[]
}>
