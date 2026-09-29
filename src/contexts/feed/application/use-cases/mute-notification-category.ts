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
} from '../../domain/notification-types'

type Input = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  category: NotificationCategory
  channel: NotificationChannel
}>

/** What the Property had of its own before a mute: its row's switch, or nothing. */
export type PreviousPropertySetting = Readonly<{ enabled: boolean }> | null

type Dependencies = Readonly<{
  newId: () => NotificationPreferenceId
  clock: () => Date
  /** The Property's own row for the category and channel, if it has one. */
  findPropertyPreference: (
    userId: string,
    orgId: string,
    propertyId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ) => Promise<Readonly<{ enabled: boolean }> | null>
  /** Inserts defaults once; conflicts update only enabled + updatedAt. */
  upsertEnabled: (preference: NotificationPreference) => Promise<NotificationPreference>
}>

export type MuteOutcome = Readonly<{
  preference: NotificationPreference
  /** What the mute replaced, so the bell's Undo can put exactly that back. */
  previous: PreviousPropertySetting
}>

const preferenceWith = (
  input: Input,
  enabled: boolean,
  deps: Pick<Dependencies, 'newId' | 'clock'>,
) => {
  const preference = createNotificationPreference(
    {
      id: deps.newId(),
      userId: input.userId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      category: input.category,
      channel: input.channel,
      enabled,
      cadence: getDefaultCadence(input.category),
    },
    deps.clock,
  )
  if (preference.isErr()) throw preference.error
  return preference.value
}

export async function muteNotificationCategory(
  input: Input,
  deps: Dependencies,
): Promise<MuteOutcome> {
  // Validated before anything is read: a required category is refused whole.
  const preference = preferenceWith(input, false, deps)
  const own = await deps.findPropertyPreference(
    input.userId,
    input.organizationId,
    input.propertyId,
    input.category,
    input.channel,
  )
  return {
    preference: await deps.upsertEnabled(preference),
    previous: own === null ? null : { enabled: own.enabled },
  }
}

type UndoDependencies = Pick<Dependencies, 'newId' | 'clock' | 'upsertEnabled'> &
  Readonly<{
    deletePropertyPreference: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
    ) => Promise<void>
  }>

/**
 * Puts back what a mute replaced. A Property that had no row of its own goes
 * back to inheriting the person's default, rather than keeping an explicit
 * "on" that would outlive a later change to that default.
 */
export async function undoNotificationCategoryMute(
  input: Input & Readonly<{ previous: PreviousPropertySetting }>,
  deps: UndoDependencies,
): Promise<void> {
  // Only what a mute accepts can be un-muted: the same construction refuses a
  // required category before anything is written.
  preferenceWith(input, false, deps)
  const { previous } = input
  if (previous === null) {
    await deps.deletePropertyPreference(
      input.userId,
      input.organizationId,
      input.propertyId,
      input.category,
      input.channel,
    )
    return
  }
  await deps.upsertEnabled(preferenceWith(input, previous.enabled, deps))
}
