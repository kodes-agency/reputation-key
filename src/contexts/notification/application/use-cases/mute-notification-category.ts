import type {
  NotificationPreferenceId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import { createNotificationPreference } from '../../domain/constructors-preference'
import { getDefaultCadence } from '../../domain/notification-policy'
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPreference,
} from '../../domain/types'

type Input = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  category: NotificationCategory
  channel: NotificationChannel
}>

type Dependencies = Readonly<{
  newId: () => NotificationPreferenceId
  clock: () => Date
  /** Inserts defaults once; conflicts update only enabled + updatedAt. */
  upsertEnabled: (preference: NotificationPreference) => Promise<NotificationPreference>
}>

export async function muteNotificationCategory(
  input: Input,
  deps: Dependencies,
): Promise<NotificationPreference> {
  const preference = createNotificationPreference(
    {
      id: deps.newId(),
      userId: input.userId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      category: input.category,
      channel: input.channel,
      enabled: false,
      cadence: getDefaultCadence(input.category),
      urgentBypassEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
    },
    deps.clock,
  )
  if (preference.isErr()) throw preference.error
  return deps.upsertEnabled(preference.value)
}
