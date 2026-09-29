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
      return { tone: 'error', message: 'Could not apply to every property' }
    }
    return {
      tone: 'error',
      message: `${CHANNEL_LABEL[firstApplied]} was applied to every property; ${CHANNEL_LABEL[outcome.failed]} could not be applied`,
    }
  }
  const [firstSkipped] = outcome.skipped
  if (firstApplied !== undefined && firstSkipped !== undefined) {
    return {
      tone: 'success',
      message: `${CHANNEL_LABEL[firstApplied]} applied to every property; ${CHANNEL_LABEL[firstSkipped]} is not enabled here`,
    }
  }
  return { tone: 'success', message: 'Applied to every property' }
}

/** Another Property whose own setting "Apply to all" would replace. */
export type SetDifferently = Readonly<{
  name: string
  /** Its in-app channel is off, as a mute from the bell leaves it. */
  muted: boolean
}>

/**
 * The other Properties with a setting of their own for `category`, which
 * "Apply to all my properties" replaces: the answer becomes the person's
 * default, and every Property row that would override it is deleted — a mute
 * made from the bell included. The page asks before doing that to any of them.
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
        name: property.name,
        own: own.length > 0,
        muted: own.some((row) => row.channel === 'in_app' && !row.enabled),
      }
    })
    .filter((property) => property.own)
    .map(({ name, muted }) => ({ name, muted }))
}

/** "Harbor & Pine", "Harbor & Pine and Riverside Hotel", "A, B and 3 others". */
export function namesInBrief(names: ReadonlyArray<string>): string {
  if (names.length <= 2) return names.join(' and ')
  const others = names.length - 2
  return `${names.slice(0, 2).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`
}
