// "Apply to all my properties" saves each channel of a category as the
// person's default, one after another. Each save commits on its own, so a
// failure part-way leaves the channels before it applied everywhere — the
// notice has to say so rather than report that nothing happened.

import type { NotificationChannel } from '#/contexts/feed/application/public-api'

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
