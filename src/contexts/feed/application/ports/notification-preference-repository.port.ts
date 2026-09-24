// Feed notification surface — repository port for notification preferences
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type {
  NotificationCategory,
  NotificationCategoryDefault,
  NotificationChannel,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
  NotificationUserSettings,
  PersonalDeliveryWindow,
} from '../../domain/notification-types'
import type { CategoryPreferenceValues } from '../../domain/notification-preference-resolution'
import type { UserId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export type NotificationPreferenceRepositoryPort = Readonly<{
  /**
   * What delivery actually asks: the Property's own row, else the person's
   * default for the category, else the versioned defaults. Never null — a
   * Property nobody has configured still has an answer (ADR 0046 r.1).
   */
  resolveForDelivery(
    userId: UserId,
    orgId: OrganizationId,
    propertyId: PropertyId,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<CategoryPreferenceValues>
  /**
   * When email is held back for this recipient, and whether urgent mail may
   * go anyway. `propertyId` is null for the daily digest, which covers every
   * Property at once and therefore reads only the person's own window (ADR
   * 0046 r.4); a Property override replaces it whole for Property-scoped mail.
   */
  resolveDeliveryWindow(
    userId: UserId,
    orgId: OrganizationId,
    propertyId: PropertyId | null,
  ): Promise<PersonalDeliveryWindow>
  upsert(preference: NotificationPreference): Promise<NotificationPreference>
  /**
   * The person's answer for a category everywhere: the default a Property
   * with no row inherits, and — because "apply to all" means all — the
   * removal of the per-Property rows that would have overridden it.
   */
  applyCategoryDefaultEverywhere(
    categoryDefault: NotificationCategoryDefault,
  ): Promise<NotificationCategoryDefault>
  findByUser(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<readonly NotificationPreference[]>
  findCategoryDefaults(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<readonly NotificationCategoryDefault[]>
  findPropertyDeliveryWindows(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<readonly NotificationPropertyDeliveryWindow[]>
  upsertPropertyDeliveryWindow(
    window: NotificationPropertyDeliveryWindow,
  ): Promise<NotificationPropertyDeliveryWindow>
  /** Follow the person's own window again. */
  clearPropertyDeliveryWindow(
    userId: UserId,
    orgId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<void>
  getUserSettings(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<NotificationUserSettings | null>
  upsertUserSettings(
    settings: NotificationUserSettings,
  ): Promise<NotificationUserSettings>
}>
