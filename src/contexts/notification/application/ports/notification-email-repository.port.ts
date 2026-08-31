// Notification context — repository port for the email queue
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type {
  DeliveryErrorClass,
  NotificationCadence,
  NotificationEmail,
} from '../../domain/types'
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

export type NotificationDigestBatchState =
  'prepared' | 'retryable' | 'accepted' | 'terminal'

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
    }>
  | Readonly<{
      kind: 'content_mismatch'
      detectedAt: Date
    }>
  | Readonly<{
      kind: 'invalidated'
      reason: string
      invalidatedAt: Date
    }>

export type NotificationEmailRepositoryPort = Readonly<{
  insert(email: NotificationEmail): Promise<NotificationEmail>
  findById(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId | null,
  ): Promise<NotificationEmail | null>
  findDueByProperty(
    orgId: OrganizationId,
    propertyId: PropertyId,
    cadence: NotificationCadence,
    now: Date,
  ): Promise<readonly NotificationEmail[]>
  markAccepted(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId | null,
    providerMessageId: string,
    acceptedAt: Date,
  ): Promise<void>
  markDelayed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId | null,
    notBefore: Date,
    updatedAt: Date,
  ): Promise<void>
  markFailed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId | null,
    classification: DeliveryErrorClass,
    nextAttemptAt: Date | null,
    failedAt: Date,
  ): Promise<void>
  markSuppressed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId | null,
    reason: string,
    updatedAt: Date,
  ): Promise<void>
  /**
   * ADR 0046 r.4: the digest is one email per USER, so the sweep must start
   * from recipients rather than from properties.
   */
  findDueRecipients(
    cadence: NotificationCadence,
    now: Date,
  ): Promise<readonly NotificationEmailRecipient[]>
  /** Every due row for one recipient, across all of the org's properties. */
  findDueByUser(
    orgId: OrganizationId,
    userId: UserId,
    cadence: NotificationCadence,
    now: Date,
  ): Promise<readonly NotificationEmail[]>
  /**
   * ADR 0046 r.6: apply a provider delivery event. Returns the rows it moved —
   * empty when the provider message id is unknown, or when the transition
   * would go backwards (a late `delivered` must not overwrite a `bounced`).
   */
  recordProviderState(
    providerMessageId: string,
    state: 'delivered' | 'bounced' | 'complained',
    occurredAt: Date,
  ): Promise<readonly ProviderStateTransition[]>
  /**
   * Stop mailing a dead address: suppress every still-sendable row the
   * recipient has in this organization. Returns the number of rows suppressed.
   */
  suppressRecipient(
    userId: UserId,
    orgId: OrganizationId,
    reason: string,
    updatedAt: Date,
  ): Promise<number>
  /** True once the recipient has any bounced/complained row in this org. */
  isRecipientSuppressed(userId: UserId, orgId: OrganizationId): Promise<boolean>
  /** Return the sole prepared/retryable recipient batch, if one exists. */
  findOpenDigestBatch(
    orgId: OrganizationId,
    userId: UserId,
  ): Promise<NotificationDigestBatch | null>
  /** Load only the queue rows durably bound to this batch, in frozen order. */
  findDigestBatchEntries(
    batchId: NotificationDigestBatchId,
    orgId: OrganizationId,
    userId: UserId,
  ): Promise<readonly NotificationEmail[]>
  /**
   * Atomically create a batch and exact memberships, or return the open batch
   * won by another worker. Candidate rows are revalidated under the lock.
   */
  prepareDigestBatch(input: {
    id: NotificationDigestBatchId
    organizationId: OrganizationId
    userId: UserId
    localDate: string
    memberIds: readonly NotificationEmailId[]
    memberDigest: string
    contentDigest: string
    providerIdempotencyKey: string
    unsubscribeKeyVersion: string
    preparedAt: Date
  }): Promise<PreparedNotificationDigestBatch>
  /** Update the batch and every exact member in one transaction. */
  settleDigestBatch(input: {
    batchId: NotificationDigestBatchId
    organizationId: OrganizationId
    userId: UserId
    expectedContentDigest: string
    settlement: DigestBatchSettlement
  }): Promise<boolean>
}>
