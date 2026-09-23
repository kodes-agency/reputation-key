// ADR 0046 r.3 — the notification language and timezone a user actually gets.
//
// Delivery resolves the recipient's clock as "the user's own timezone, else the
// Organization's" (recipient-timezone.ts), but the settings page and the bell
// read the raw settings row. A user who never saved one therefore saw UTC while
// quiet hours and the 08:00 digest ran on their Organization's zone — and
// saving only a language wrote that UTC over the Organization fallback. Both
// surfaces now read the zone delivery uses, and a save writes only what the
// user changed.

import { propertyId, type OrganizationId, type UserId } from '#/shared/domain/ids'
import type { NotificationPreferenceRepositoryPort } from '../application/ports/notification-preference-repository.port'
import type { NotificationQuietHoursInput } from '../application/dto/notification-preference.dto'
import type { NotificationUserSettingsInput } from '../application/dto/notification-user-settings.dto'
import { createPersonalDeliveryWindow } from '../domain/constructors-preference'
import { DEFAULT_NOTIFICATION_LOCALE } from '../domain/notification-policy'
import { NO_QUIET_HOURS } from '../domain/notification-preference-resolution'
import type {
  EffectiveNotificationSettings,
  NotificationTimezoneSource,
  NotificationUserSettings,
  PersonalDeliveryWindow,
} from '../domain/notification-types'
import type { NotificationOrganizationScopeResolver } from './repositories/notification-organization-scope.repository'
import {
  isResolvableTimezone,
  recipientTimezoneSource,
  resolveRecipientTimezone,
  type RecipientTimezoneSource,
} from './jobs/recipient-timezone'

type Deps = Readonly<{
  preferenceRepo: Pick<
    NotificationPreferenceRepositoryPort,
    | 'getUserSettings'
    | 'upsertUserSettings'
    | 'upsertPropertyDeliveryWindow'
    | 'clearPropertyDeliveryWindow'
  >
  resolveOrganizationScope: NotificationOrganizationScopeResolver
  clock: () => Date
}>

/**
 * An omitted field in a quiet-hours save means "nothing here", not "keep what
 * was there": the form always carries the whole window, and a Property
 * override with no times is the real answer "hold nothing back here".
 */
const windowFrom = (change: NotificationQuietHoursInput): PersonalDeliveryWindow => ({
  quietHoursStart: change.quietHoursStart ?? null,
  quietHoursEnd: change.quietHoursEnd ?? null,
  urgentBypassEnabled: change.urgentBypassEnabled ?? false,
})

/** No Property candidate is offered here, so only these three can win. */
const settingsSource = (source: RecipientTimezoneSource): NotificationTimezoneSource =>
  source === 'user' || source === 'organization' ? source : 'default'

export const createNotificationUserSettings = (deps: Deps) => {
  /** The digest's resolution: the user's zone, else the Organization's, else UTC. */
  const effective = async (
    saved: NotificationUserSettings | null,
    organizationId: OrganizationId,
  ): Promise<EffectiveNotificationSettings> => {
    const organizationTimezone = isResolvableTimezone(saved?.timezone)
      ? null
      : (await deps.resolveOrganizationScope(organizationId)).timezone
    const sources = { userTimezone: saved?.timezone ?? null, organizationTimezone }
    return {
      locale: saved?.locale ?? DEFAULT_NOTIFICATION_LOCALE,
      timezone: resolveRecipientTimezone(sources),
      timezoneSource: settingsSource(recipientTimezoneSource(sources)),
      quietHoursStart: saved?.quietHoursStart ?? NO_QUIET_HOURS.quietHoursStart,
      quietHoursEnd: saved?.quietHoursEnd ?? NO_QUIET_HOURS.quietHoursEnd,
      urgentBypassEnabled:
        saved?.urgentBypassEnabled ?? NO_QUIET_HOURS.urgentBypassEnabled,
    }
  }

  const read = async (
    userId: UserId,
    organizationId: OrganizationId,
  ): Promise<EffectiveNotificationSettings> =>
    effective(
      await deps.preferenceRepo.getUserSettings(userId, organizationId),
      organizationId,
    )

  /**
   * An omitted field keeps its effective value. The column cannot hold "follow
   * the Organization", so a first save that changes only the language stores
   * the zone delivery was already using — never a UTC default in its place.
   */
  const save = async (
    userId: UserId,
    organizationId: OrganizationId,
    change: NotificationUserSettingsInput,
  ): Promise<EffectiveNotificationSettings> => {
    const current = await read(userId, organizationId)
    const now = deps.clock()
    const stored = await deps.preferenceRepo.upsertUserSettings({
      userId,
      organizationId,
      locale: change.locale ?? current.locale,
      timezone: change.timezone ?? current.timezone,
      // The window is the other half of this row. Writing it back as it
      // stands keeps a formatting save from clearing quiet hours.
      quietHoursStart: current.quietHoursStart,
      quietHoursEnd: current.quietHoursEnd,
      urgentBypassEnabled: current.urgentBypassEnabled,
      createdAt: now,
      updatedAt: now,
    })
    return effective(stored, organizationId)
  }

  /**
   * Quiet hours and the urgent bypass (ADR 0046 amended 2026-09-23): the
   * person's own by default, or one Property's deliberate override of them.
   *
   * The personal window shares a row with the timezone, so the zone in effect
   * is written back with it for the same reason a formatting save writes back
   * the window. An override is its own row, and removing that row is how a
   * Property goes back to following the person.
   */
  const saveQuietHours = async (
    userId: UserId,
    organizationId: OrganizationId,
    change: NotificationQuietHoursInput,
  ): Promise<EffectiveNotificationSettings> => {
    const now = deps.clock()
    if (change.propertyId !== undefined) {
      const property = propertyId(change.propertyId)
      if (change.follow === true) {
        await deps.preferenceRepo.clearPropertyDeliveryWindow(
          userId,
          organizationId,
          property,
        )
        return read(userId, organizationId)
      }
      const validated = createPersonalDeliveryWindow(windowFrom(change))
      if (validated.isErr()) throw validated.error
      await deps.preferenceRepo.upsertPropertyDeliveryWindow({
        userId,
        organizationId,
        propertyId: property,
        ...validated.value,
        createdAt: now,
        updatedAt: now,
      })
      return read(userId, organizationId)
    }
    const validated = createPersonalDeliveryWindow(windowFrom(change))
    if (validated.isErr()) throw validated.error
    const current = await read(userId, organizationId)
    const stored = await deps.preferenceRepo.upsertUserSettings({
      userId,
      organizationId,
      locale: current.locale,
      timezone: current.timezone,
      ...validated.value,
      createdAt: now,
      updatedAt: now,
    })
    return effective(stored, organizationId)
  }

  return { read, save, saveQuietHours } as const
}
