// "Apply to all my properties" saves each channel of a category as the
// person's default, one after another. Each save commits on its own, so a
// failure part-way leaves the channels before it applied everywhere — the
// notice has to say so rather than report that nothing happened.

import type {
  ConfigurableNotificationCategory,
  NotificationChannel,
  NotificationPreference,
} from '#/contexts/feed/application/public-api'

export type ApplyEverywhereOutcome = Readonly<{
  applied: readonly NotificationChannel[]
  /** The channel whose save failed; the ones after it were not tried. */
  failed: NotificationChannel | null
  /** Channels deliberately left alone. */
  skipped: readonly NotificationChannel[]
}>

/**
 * Saves in-app, then email. Email is skipped while the Property in view cannot
 * send it: the server refuses an email save without `notification.send_email`,
 * and the page already shows that channel as unavailable and inert.
 */
export async function applyEverywhereInOrder(
  emailAllowed: boolean,
  save: (channel: NotificationChannel) => Promise<unknown>,
): Promise<ApplyEverywhereOutcome> {
  const channels: readonly NotificationChannel[] = emailAllowed
    ? ['in_app', 'email']
    : ['in_app']
  const skipped: readonly NotificationChannel[] = emailAllowed ? [] : ['email']
  let applied: readonly NotificationChannel[] = []
  for (const channel of channels) {
    try {
      await save(channel)
    } catch {
      return { applied, failed: channel, skipped }
    }
    applied = [...applied, channel]
  }
  return { applied, failed: null, skipped }
}

const CHANNEL_LABEL: Readonly<Record<NotificationChannel, string>> = {
  in_app: 'In-app',
  email: 'email',
}

export function applyEverywhereNotice(
  outcome: ApplyEverywhereOutcome,
): Readonly<{ tone: 'success' | 'error'; message: string }> {
  const [firstApplied] = outcome.applied
  if (outcome.failed !== null) {
    if (firstApplied === undefined) {
      return { tone: 'error', message: 'Could not make this your default' }
    }
    return {
      tone: 'error',
      message: `${CHANNEL_LABEL[firstApplied]} is now your default; ${CHANNEL_LABEL[outcome.failed]} could not be saved`,
    }
  }
  const [firstSkipped] = outcome.skipped
  if (firstApplied !== undefined && firstSkipped !== undefined) {
    return {
      tone: 'success',
      message: `${CHANNEL_LABEL[firstApplied]} is now your default; ${CHANNEL_LABEL[firstSkipped]} is not enabled here`,
    }
  }
  return {
    tone: 'success',
    message: 'Now your default for every property without its own setting',
  }
}

/** Another Property with a setting of its own, which a default leaves alone (D7). */
export type SetDifferently = Readonly<{
  id: string
  name: string
  /** Its in-app channel is off, as a mute from the bell leaves it. */
  muted: boolean
}>

/**
 * The other Properties with a setting of their own for `category`. Making an
 * answer the person's default leaves them as they are (D7); the page names
 * them, and resetting them is a choice of its own.
 */
export function setDifferentlyElsewhere(
  category: ConfigurableNotificationCategory,
  preferences: ReadonlyArray<NotificationPreference>,
  properties: ReadonlyArray<Readonly<{ id: string; name: string }>>,
  propertyInView: string,
): ReadonlyArray<SetDifferently> {
  return properties
    .filter((property) => property.id !== propertyInView)
    .map((property) => {
      const own = preferences.filter(
        (row) => (row.propertyId as string) === property.id && row.category === category,
      )
      return {
        id: property.id,
        name: property.name,
        own: own.length > 0,
        muted: own.some((row) => row.channel === 'in_app' && !row.enabled),
      }
    })
    .filter((property) => property.own)
    .map(({ id, name, muted }) => ({ id, name, muted }))
}

/** "Harbor & Pine", "Harbor & Pine and Riverside Hotel", "A, B and 3 others". */
export function namesInBrief(names: ReadonlyArray<string>): string {
  if (names.length <= 2) return names.join(' and ')
  const others = names.length - 2
  return `${names.slice(0, 2).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`
}

/** Whether the Property in view has a setting of its own for `category`. */
export const hasOwnSetting = (
  category: ConfigurableNotificationCategory,
  preferences: ReadonlyArray<NotificationPreference>,
  propertyInView: string,
): boolean =>
  preferences.some(
    (row) => (row.propertyId as string) === propertyInView && row.category === category,
  )
