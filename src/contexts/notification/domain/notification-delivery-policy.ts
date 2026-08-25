import type { DeliveryErrorClass, NotificationCategory, NotificationType } from './types'

export type NotificationDeliveryOutcome =
  | Readonly<{ kind: 'accepted'; providerMessageId: string; acceptedAt: Date }>
  | Readonly<{
      kind: 'rejected'
      classification: DeliveryErrorClass
      providerCode: string | null
    }>

export type QuietHours = Readonly<{
  start: string
  end: string
}>

export type DeliveryTiming =
  Readonly<{ kind: 'send' }> | Readonly<{ kind: 'defer'; until: Date }>

const CATEGORY_BY_TYPE: Readonly<Record<NotificationType, NotificationCategory>> = {
  'review.created': 'workflow_collaboration',
  'feedback.created': 'workflow_collaboration',
  'reply.pending_approval': 'urgent_operational',
  'reply.approved': 'workflow_collaboration',
  'reply.rejected': 'workflow_collaboration',
  'reply.published': 'workflow_collaboration',
  'reply.publish_failed': 'urgent_operational',
  'inbox.escalated': 'urgent_operational',
  'inbox.assigned': 'workflow_collaboration',
  'inbox_note.added': 'workflow_collaboration',
  'portal.responsibility_needed': 'urgent_operational',
  // Recognition, NOT a digest: `digest_summary` defaulted to
  // {in_app:false, email:false}, so a goal completion classified as a digest
  // was DROPPED entirely for any tenant without preference rows — nothing was
  // persisted and nothing was mailed. A completed goal is recognition
  // (ADR 0046: "On privately"), same as a badge. The digest category itself is
  // retired; a daily digest is a cadence (see domain/types.ts).
  'goal.completed': 'recognition',
  'badge.awarded': 'recognition',
}

export function classifyNotification(type: NotificationType): NotificationCategory {
  return CATEGORY_BY_TYPE[type]
}

/**
 * Every category in the union, in the order the settings page should list them.
 * Settings must show all of them: ADR 0046 reserves `mandatory` for
 * account/security/legal mail, and a user needs to see that it exists and is
 * non-disableable even while no type maps to it yet.
 */
export const NOTIFICATION_CATEGORIES: ReadonlyArray<NotificationCategory> = [
  'mandatory',
  'urgent_operational',
  'workflow_collaboration',
  'recognition',
]

/**
 * Categories that actually govern at least one notification type — derived
 * from `CATEGORY_BY_TYPE`, never hand-listed, so it cannot drift.
 *
 * This is the list a FILTER may offer. Today it excludes `mandatory`, because
 * zero of the twelve types classify as mandatory and a filter that can only
 * ever return nothing is a bug, not a feature.
 */
export const GOVERNING_NOTIFICATION_CATEGORIES: ReadonlyArray<NotificationCategory> =
  NOTIFICATION_CATEGORIES.filter((category) =>
    Object.values(CATEGORY_BY_TYPE).includes(category),
  )

function minuteOfDay(value: string): number {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value)
  if (!match) throw new RangeError(`Invalid quiet-hours time: ${value}`)
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function localMinute(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new RangeError(`Unable to resolve timezone: ${timezone}`)
  }
  return hour * 60 + minute
}

function isQuietMinute(minute: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

function firstNonQuietMinute(
  now: Date,
  timezone: string,
  start: number,
  end: number,
): Date {
  let low = Math.floor(now.getTime() / 60_000) * 60_000
  let high = low + 60_000
  const maximum = low + 27 * 60 * 60_000

  while (
    high <= maximum &&
    isQuietMinute(localMinute(new Date(high), timezone), start, end)
  ) {
    const local = localMinute(new Date(high), timezone)
    const remaining =
      start < end ? end - local : local < end ? end - local : 1_440 - local + end
    high += Math.max(remaining, 1) * 60_000
  }
  if (high > maximum)
    throw new RangeError(`Unable to resolve quiet-hours end in ${timezone}`)

  while (high - low > 60_000) {
    const middle = low + Math.floor((high - low) / 120_000) * 60_000
    if (isQuietMinute(localMinute(new Date(middle), timezone), start, end)) low = middle
    else high = middle
  }
  return new Date(high)
}

export function deliveryTiming(
  input: Readonly<{
    now: Date
    timezone: string
    quietHoursStart: string | null
    quietHoursEnd: string | null
    urgent: boolean
    urgentBypassEnabled: boolean
  }>,
): DeliveryTiming {
  if (input.urgent && input.urgentBypassEnabled) return { kind: 'send' }
  if (input.quietHoursStart === null || input.quietHoursEnd === null)
    return { kind: 'send' }

  const start = minuteOfDay(input.quietHoursStart)
  const end = minuteOfDay(input.quietHoursEnd)
  if (!isQuietMinute(localMinute(input.now, input.timezone), start, end))
    return { kind: 'send' }

  return {
    kind: 'defer',
    until: firstNonQuietMinute(input.now, input.timezone, start, end),
  }
}

export function isDailyDigestWindow(now: Date, timezone: string): boolean {
  const minute = localMinute(now, timezone)
  return minute >= 8 * 60 && minute < 9 * 60
}

export function classifyProviderRejection(
  input: Readonly<{
    statusCode: number | null
    providerCode: string | null
    message: string
  }>,
): DeliveryErrorClass {
  const detail = `${input.providerCode ?? ''} ${input.message}`.toLowerCase()
  if (
    detail.includes('suppress') ||
    detail.includes('bounce') ||
    detail.includes('complaint')
  ) {
    return 'suppressed'
  }
  return input.statusCode === 429 ||
    (input.statusCode !== null && input.statusCode >= 500)
    ? 'transient'
    : 'permanent'
}

export function requiredCapabilityForPreferenceChannel(
  channel: 'in_app' | 'email',
): 'notification.send_email' | undefined {
  return channel === 'email' ? 'notification.send_email' : undefined
}
