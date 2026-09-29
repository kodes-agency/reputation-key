// What one notification row says, decided once for the row and for the name a
// screen reader hears. Pure, like `inboxRowView`: copy comes from
// `renderNotification`, facts from the payload, nothing is authored here.
//
// The title leaves the Property out. The facts line names it, and only where
// the notice's own copy would have: a Google reconnect notice is filed under
// a Property as its delivery anchor, and its copy deliberately never names it.

import {
  isActionableNotificationType,
  isStillWaiting,
  notificationRepeatCount,
  renderNotification,
  waitingAge,
  type NotificationView,
} from '#/contexts/feed/application/public-api'

/**
 * What the row asks of its reader, carried by its icon: red when it is on a
 * clock, full ink when it waits on them, muted when it is news, a green check
 * when the work was finished upstream.
 */
export type NotificationRowTone = 'critical' | 'needs-you' | 'update' | 'done'

export type NotificationRowView = Readonly<{
  /** The title without its Property. */
  title: string
  /** The title as every other channel shows it, Property included. */
  fullTitle: string
  /** The sentence under the title, or '' when the title says it all. */
  detail: string
  tone: NotificationRowTone
  /** Unread and still asking: a settled row stops asking, so it drops the dot. */
  isUnread: boolean
  /** The Property for the facts line, when the copy names one and the surface wants it. */
  property: string | null
  targetPassed: boolean
  rating: number | undefined
  /** "3h" / "2d" the item had waited, or ''. */
  waited: string
  /** How many times the notice happened; shown as "×3" past one. */
  repeats: number
  accessibleName: string
}>

function toneOf(notification: NotificationView): NotificationRowTone {
  if (notification.resolvedAt !== null) return 'done'
  if (!isStillWaiting(notification)) return 'update'
  if (
    notification.priority === 'urgent' ||
    notification.type === 'inbox.response_target_passed'
  ) {
    return 'critical'
  }
  return isActionableNotificationType(notification.type) ? 'needs-you' : 'update'
}

type Options = Readonly<{
  timeZone: string
  /** False where a heading already names the Property (the page's groups). */
  showProperty: boolean
  /** When it happened, in words: "12 minutes ago". */
  when: string
}>

export function notificationRowView(
  notification: NotificationView,
  options: Options,
): NotificationRowView {
  const payload = notification.payload
  const context = { timeZone: options.timeZone }
  const full = renderNotification(notification.type, payload, context)
  const title = renderNotification(
    notification.type,
    { ...payload, propertyName: undefined },
    context,
  ).title
  const tone = toneOf(notification)
  const namesProperty = full.title !== title
  const property =
    options.showProperty && namesProperty ? (payload.propertyName ?? null) : null
  const targetPassed =
    notification.type === 'inbox.response_target_passed' && tone !== 'done'
  const waited = tone === 'done' ? '' : waitingAge(payload)
  const repeats = notificationRepeatCount(notification.type, payload)
  const isUnread = isStillWaiting(notification)

  const accessibleName = [
    full.title,
    tone === 'done' ? 'done' : '',
    targetPassed ? 'target passed' : '',
    payload.guestRating === undefined ? '' : `rated ${payload.guestRating} of 5`,
    waited === '' ? '' : `waited ${waited}`,
    repeats > 1 ? `${repeats} times` : '',
    options.when,
    isUnread ? 'unread' : '',
  ]
    .filter((part) => part !== '')
    .join(', ')

  return {
    title,
    fullTitle: full.title,
    detail: full.detail,
    tone,
    isUnread,
    property,
    targetPassed,
    rating: payload.guestRating,
    waited,
    repeats,
    accessibleName,
  }
}
