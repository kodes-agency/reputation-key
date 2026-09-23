import type {
  ConfigurableNotificationCategory,
  DeliveryErrorClass,
  NotificationCategory,
  NotificationType,
} from './notification-types'

export type NotificationDeliveryOutcome =
  | Readonly<{ kind: 'accepted'; providerMessageId: string; acceptedAt: Date }>
  | Readonly<{
      kind: 'rejected'
      classification: DeliveryErrorClass
      providerCode: string | null
      /**
       * Present when the provider answered before accepting anything (see
       * `rejectionProvesNonAcceptance`), so a send under a NEW idempotency key
       * cannot mail twice. Absent when the message may still have been accepted.
       */
      refusedBeforeAcceptance?: true
    }>

export type QuietHours = Readonly<{
  start: string
  end: string
}>

export type DeliveryTiming =
  Readonly<{ kind: 'send' }> | Readonly<{ kind: 'defer'; until: Date }>

const CATEGORY_BY_TYPE: Readonly<Record<NotificationType, NotificationCategory>> = {
  'account.organization_access_granted': 'mandatory',
  'account.organization_role_changed': 'mandatory',
  'account.organization_access_removed': 'mandatory',
  'account.organization_purge_pending': 'mandatory',
  'review.created': 'workflow_collaboration',
  'review.updated': 'urgent_operational',
  // Private feedback asks a manager to review and handle a guest concern. It
  // is Action Required even when it is not marked urgent enough to bypass
  // quiet hours.
  'feedback.created': 'urgent_operational',
  'reply.pending_approval': 'urgent_operational',
  'reply.approved': 'workflow_collaboration',
  'reply.rejected': 'workflow_collaboration',
  'reply.published': 'workflow_collaboration',
  'reply.publish_failed': 'urgent_operational',
  'inbox.escalated': 'urgent_operational',
  'inbox.escalation_resolved': 'workflow_collaboration',
  'inbox.reopened': 'urgent_operational',
  // One grouped notice for a bulk reopen: the same attention as a single
  // reopen, but one row and at most one email per recipient per Property.
  'inbox.bulk_reopened': 'urgent_operational',
  'inbox.response_target_halfway': 'workflow_collaboration',
  // A passed target belongs in the operational-attention category, but it is
  // deliberately absent from URGENT_TYPES: it respects quiet hours and never
  // becomes an automatic escalation.
  'inbox.response_target_passed': 'urgent_operational',
  'inbox.assigned': 'workflow_collaboration',
  'inbox.bulk_assigned': 'workflow_collaboration',
  'inbox_note.added': 'workflow_collaboration',
  'portal.responsibility_needed': 'urgent_operational',
  'portal.health_attention': 'urgent_operational',
  'property.responsibility_needed': 'urgent_operational',
  'integration.reauthorization_required': 'urgent_operational',
  // Recognition, NOT a digest: `digest_summary` defaulted to
  // {in_app:false, email:false}, so a goal completion classified as a digest
  // was DROPPED entirely for any tenant without preference rows — nothing was
  // persisted and nothing was mailed. A completed goal is recognition under
  // ADR 0046 ("On privately"). The digest category itself is retired; a daily
  // digest is a cadence (see domain/notification-types.ts). Goal results are
  // the category's only live types, so people see it as "Goals" (ADR 0046,
  // amended 2026-09-22). Not workflow: muting a goal row must not also mute
  // assignments and notes.
  'goal.completed': 'recognition',
  'goal.result_revised': 'recognition',
  // The reporter's own report was accepted, not planned, or resolved. It is
  // collaboration on something they raised: in-app by default, never mailed.
  'beta_feedback.outcome': 'workflow_collaboration',
}

export function classifyNotification(type: NotificationType): NotificationCategory {
  return CATEGORY_BY_TYPE[type]
}

/**
 * Organization-scoped notices that are NOT mandatory (ADR 0059). Each is about
 * a record the recipient owns at the Organization level, so there is no
 * Property to scope it to and no Property preference row to consult: it
 * resolves through ADR 0046's versioned defaults, and its email channel stays
 * off. The database admits exactly these types in that shape and no others.
 */
export const ORGANIZATION_INFORMATIONAL_TYPES: ReadonlySet<NotificationType> = new Set([
  'beta_feedback.outcome',
])

/**
 * Mandatory account/security notices belong to the Organization, as do the
 * few informational notices above. Every other active family remains
 * Property-scoped. Keeping this derived from the category map and one explicit
 * list prevents callers from inventing a Property for an account fact — or an
 * Organization scope for a Property one.
 */
export function notificationScopeForType(
  type: NotificationType,
): 'organization' | 'property' {
  return classifyNotification(type) === 'mandatory' ||
    ORGANIZATION_INFORMATIONAL_TYPES.has(type)
    ? 'organization'
    : 'property'
}

/**
 * Every retained category in the persisted model. Row mapping and preference
 * reads validate against this complete list; active controls use the narrower
 * surface lists below.
 */
export const NOTIFICATION_CATEGORIES: ReadonlyArray<NotificationCategory> = [
  'mandatory',
  'urgent_operational',
  'workflow_collaboration',
  'recognition',
]

/**
 * Categories offered as Property preference controls. `mandatory` is
 * Organization policy and therefore has no Property preference row.
 * `recognition` carries the live goal results, so it is a control like the
 * others: in-app on by default, email opt-in (ADR 0046).
 */
export const NOTIFICATION_SETTINGS_CATEGORIES: ReadonlyArray<ConfigurableNotificationCategory> =
  ['urgent_operational', 'workflow_collaboration', 'recognition']

/**
 * Categories that govern at least one notification type — derived from
 * `CATEGORY_BY_TYPE`, never hand-listed, so it cannot drift. This is the list
 * a FILTER may offer.
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

const MINUTE_MS = 60_000

/**
 * The largest daylight-saving shift in the tz database: Antarctica/Troll moves
 * two hours. A jump across quiet time stops this far short of the window's
 * wall-clock end, so a spring-forward inside the jump cannot carry it past the
 * end and into the next quiet window.
 */
const MAX_DST_SHIFT_MINUTES = 120

/**
 * How far ahead a sendable minute is looked for. A quiet window is shorter
 * than a day, but a transition day can erase a sendable window no longer than
 * its shift (02:00–03:00 does not exist in New York on a spring-forward night),
 * which moves the answer into the following day.
 */
const SEARCH_HORIZON_MINUTES = 50 * 60

/** One formatter per timezone lookup, reused for every minute probed. */
function localMinuteReader(timezone: string): (instant: number) => number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return (instant) => {
    const parts = format.formatToParts(instant)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      throw new RangeError(`Unable to resolve timezone: ${timezone}`)
    }
    return hour * 60 + minute
  }
}

function localMinute(date: Date, timezone: string): number {
  return localMinuteReader(timezone)(date.getTime())
}

function isQuietMinute(minute: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

/** Wall-clock minutes from a quiet `minute` until its quiet window ends. */
function quietMinutesRemaining(minute: number, start: number, end: number): number {
  return start < end ? end - minute : minute < end ? end - minute : 1_440 - minute + end
}

/**
 * The first whole minute after `now` that falls outside quiet hours, walked in
 * real time. The remaining quiet time is a WALL-CLOCK distance, which a
 * daylight-saving change stretches or shrinks: jumping all of it as real time
 * overshot a short sendable window on a spring-forward day and threw.
 *
 * When the clock advances by exactly that distance, no change fell in between
 * and the window's end is the answer. Otherwise each jump stops
 * MAX_DST_SHIFT_MINUTES short and the rest is walked minute by minute, so the
 * answer is never inside quiet hours. A fall-back hour replayed just before
 * the window starts can be skipped: late, never early.
 */
function firstNonQuietMinute(
  now: Date,
  timezone: string,
  start: number,
  end: number,
): Date {
  const minuteAt = localMinuteReader(timezone)
  const first = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS
  const horizon = first + SEARCH_HORIZON_MINUTES * MINUTE_MS
  let candidate = first + MINUTE_MS

  while (candidate < horizon) {
    const minute = minuteAt(candidate)
    if (!isQuietMinute(minute, start, end)) return new Date(candidate)
    const remaining = quietMinutesRemaining(minute, start, end)
    const windowEnd = candidate + remaining * MINUTE_MS
    if ((minuteAt(windowEnd) - minute + 1_440) % 1_440 === remaining) {
      return new Date(windowEnd)
    }
    candidate += Math.max(remaining - MAX_DST_SHIFT_MINUTES, 1) * MINUTE_MS
  }
  // Nothing sendable within two days. Deferring to the horizon lets the send
  // path evaluate quiet hours again then, instead of failing the delivery now.
  return new Date(horizon)
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

/** A timeout and a rate or quota limit: the provider asks to be tried again. */
const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([408, 429])

/**
 * Transient means "try again under the same idempotency key", which the
 * provider dedupes, so a retry can never mail twice. That makes transient the
 * safe answer whenever the provider did not say no for good:
 *
 *  - `statusCode: null` is how the Resend SDK reports a request that never got
 *    an answer — DNS, a refused or reset connection, TLS, a response lost
 *    mid-body. It returns that rather than throwing, so treating it as
 *    permanent dropped urgent mail and whole digests on any connectivity blip.
 *  - 409 `concurrent_idempotent_requests` means the first request with this
 *    key is still in flight. A 409 `invalid_idempotent_request` (same key,
 *    different body) stays permanent: retrying it cannot succeed.
 */
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
  if (input.statusCode === null) return 'transient'
  if (input.statusCode === 409) {
    return input.providerCode === 'concurrent_idempotent_requests'
      ? 'transient'
      : 'permanent'
  }
  return RETRYABLE_STATUS_CODES.has(input.statusCode) || input.statusCode >= 500
    ? 'transient'
    : 'permanent'
}

/**
 * Whether a rejection proves the provider never accepted the message. Only an
 * answer it gives before taking the message does: a rate or quota limit, a
 * validation failure. No answer, a timeout, a 5xx, or a 409 on the idempotency
 * key can each follow a message it accepted, so none of them proves anything.
 */
export function rejectionProvesNonAcceptance(statusCode: number | null): boolean {
  return (
    statusCode !== null &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 409
  )
}

export function requiredCapabilityForPreferenceChannel(
  channel: 'in_app' | 'email',
): 'notification.send_email' | undefined {
  return channel === 'email' ? 'notification.send_email' : undefined
}
