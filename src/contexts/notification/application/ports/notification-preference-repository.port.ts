// Notification context — repository port for notification preferences
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPreference,
  NotificationUserSettings,
} from '../../domain/types'
import type { UserId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export type NotificationPreferenceRepositoryPort = Readonly<{
  findForDelivery(
    userId: UserId,
    orgId: OrganizationId,
    propertyId: PropertyId,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<NotificationPreference | null>
  upsert(preference: NotificationPreference): Promise<NotificationPreference>
  findByUser(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<readonly NotificationPreference[]>
  getUserSettings(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<NotificationUserSettings | null>
  upsertUserSettings(
    settings: NotificationUserSettings,
  ): Promise<NotificationUserSettings>
}>
