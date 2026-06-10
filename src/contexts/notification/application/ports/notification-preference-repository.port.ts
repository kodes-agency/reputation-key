// Notification context — repository port for notification preferences
// Per architecture: type alias + Readonly<{…}>, no classes.

import type { NotificationPreference, NotificationType } from '../../domain/types'
import type { UserId, OrganizationId } from '#/shared/domain/ids'

export type NotificationPreferenceRepositoryPort = Readonly<{
  findByUserAndType(
    userId: UserId,
    orgId: OrganizationId,
    type: NotificationType,
  ): Promise<NotificationPreference | null>

  /** Upsert on conflict (userId + orgId + type). */
  upsert(preference: NotificationPreference): Promise<NotificationPreference>

  findByUser(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<readonly NotificationPreference[]>
}>
