// ADR 0046 r.3 — the notification language and timezone a user actually gets.
//
// Delivery resolves the recipient's clock as "the user's own timezone, else the
// Organization's" (recipient-timezone.ts), but the settings page and the bell
// read the raw settings row. A user who never saved one therefore saw UTC while
// quiet hours and the 08:00 digest ran on their Organization's zone — and
// saving only a language wrote that UTC over the Organization fallback. Both
// surfaces now read the zone delivery uses, and a save writes only what the
// user changed.

import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { NotificationPreferenceRepositoryPort } from '../application/ports/notification-preference-repository.port'
import type { NotificationUserSettingsInput } from '../application/dto/notification-user-settings.dto'
import { DEFAULT_NOTIFICATION_LOCALE } from '../domain/notification-policy'
import type {
  EffectiveNotificationSettings,
  NotificationTimezoneSource,
  NotificationUserSettings,
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
    'getUserSettings' | 'upsertUserSettings'
  >
  resolveOrganizationScope: NotificationOrganizationScopeResolver
  clock: () => Date
}>

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
      createdAt: now,
      updatedAt: now,
    })
    return effective(stored, organizationId)
  }

  return { read, save } as const
}
