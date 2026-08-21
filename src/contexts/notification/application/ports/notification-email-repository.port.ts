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
  propertyId: PropertyId
}>

export type NotificationEmailRepositoryPort = Readonly<{
  insert(email: NotificationEmail): Promise<NotificationEmail>
  findById(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId,
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
    propertyId: PropertyId,
    providerMessageId: string,
    acceptedAt: Date,
  ): Promise<void>
  markDelayed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId,
    notBefore: Date,
    updatedAt: Date,
  ): Promise<void>
  markFailed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId,
    classification: DeliveryErrorClass,
    nextAttemptAt: Date | null,
    failedAt: Date,
  ): Promise<void>
  markSuppressed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    propertyId: PropertyId,
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
}>
