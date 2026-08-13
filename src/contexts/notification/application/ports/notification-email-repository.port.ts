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
import type { NotificationEmailId, OrganizationId, PropertyId } from '#/shared/domain/ids'

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
  recordProviderState(
    providerMessageId: string,
    state: 'delivered' | 'bounced' | 'complained',
    occurredAt: Date,
  ): Promise<void>
}>
