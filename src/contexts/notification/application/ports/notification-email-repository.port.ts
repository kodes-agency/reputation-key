// Notification context — repository port for the email queue
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type { NotificationEmail, NotificationPriority } from '../../domain/types'
import type { NotificationEmailId, OrganizationId } from '#/shared/domain/ids'

export type NotificationEmailRepositoryPort = Readonly<{
  /** Upsert on conflict (by notificationId). */
  insert(email: NotificationEmail): Promise<NotificationEmail>

  findById(
    id: NotificationEmailId,
    orgId: OrganizationId,
  ): Promise<NotificationEmail | null>

  findPendingByOrg(
    orgId: OrganizationId,
    priority: NotificationPriority,
  ): Promise<readonly NotificationEmail[]>

  markSent(
    id: NotificationEmailId,
    orgId: OrganizationId,
    sentAt: Date,
    updatedAt: Date,
  ): Promise<void>

  markFailed(
    id: NotificationEmailId,
    orgId: OrganizationId,
    failedAt: Date,
    updatedAt: Date,
  ): Promise<void>

  markSkipped(
    id: NotificationEmailId,
    orgId: OrganizationId,
    updatedAt: Date,
  ): Promise<void>
}>
