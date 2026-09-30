// Feed notification surface — insert notification use case
// Creates a notification, checks preferences, persists, and enqueues email if needed.

import {
  createNotification,
  type CreateNotificationInput,
} from '../../domain/notification-constructors'
import { createNotificationEmail } from '../../domain/constructors-email'
import type { NotificationRepositoryPort } from '../ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../ports/notification-preference-repository.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  unbrand,
  type NotificationId,
  type NotificationEmailId,
} from '#/shared/domain/ids'
import type {
  Notification as DomainNotification,
  NotificationCadence,
  NotificationCategory,
} from '../../domain/notification-types'
import { isOrganizationScopedNotice } from '../../domain/notification-delivery-policy'
import {
  applyCoalescence,
  getDefaultCadence,
  getDefaultEnabled,
} from '../../domain/notification-policy'
import type { NotificationAudience } from '../notification-audience'
import type { NotificationOrganizationEmailStopPort } from '../ports/notification-organization-email-stop.port'
import {
  isEmailStopped,
  ORGANIZATION_CLOSING_REASON,
} from '../../domain/organization-email-stop'
import {
  SETTLED_EMAIL_REASON,
  SUPERSEDED_FOR_READER,
} from '../../domain/notification-settlement'
import { isLowFor, RATED_NOTIFICATION_TYPES } from '../../domain/notification-low-ratings'
import { getDefaultMaxRating } from '../../domain/notification-policy'
import { parseNotificationPayload } from '../../domain/notification-payload'
import type { CategoryPreferenceValues } from '../../domain/notification-preference-resolution'
import type { ReviewRatingForRouting } from '../ports/review-rating-lookup.port'

// ── Input ───────────────────────────────────────────────────────────

/**
 * What durable consumers enqueue. They pass FACTS in `payload`, never a title
 * or body: copy is rendered from (type, payload) inside `createNotification`
 * so every channel and already-stored row agree (ADR 0046 r.8).
 */
export type InsertNotificationInput = Omit<CreateNotificationInput, 'id'>

// ── Deps ────────────────────────────────────────────────────────────

export type InsertNotificationDeps = Readonly<{
  notificationRepo: NotificationRepositoryPort
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  clock: () => Date
  idGen: () => NotificationId
  emailIdGen: () => NotificationEmailId
  logger: LoggerPort
  /**
   * How far the Organization's lifecycle stops email. insert-notification
   * runs with capability `none`, so it still runs behind the Closing fence;
   * refusing to queue there keeps purge readiness settleable.
   */
  organizationEmailStop: NotificationOrganizationEmailStopPort
  /**
   * A review's current eligible rating, read only to decide whether its notice
   * is a Low ratings one for the reader; compared and dropped, never stored.
   */
  ratingForRouting: ReviewRatingForRouting
  enqueueImmediateEmail?: (data: {
    notificationEmailId: string
    organizationId: string
    propertyId?: string
  }) => Promise<void>
}>

type ChannelPreferences = Readonly<{
  inAppEnabled: boolean
  emailEnabled: boolean
  emailCadence: NotificationCadence
}>

const resolveChannelPreferences = async (
  deps: InsertNotificationDeps,
  input: InsertNotificationInput,
  /** The row's own category: private feedback's depends on its parsed rating. */
  category: NotificationCategory,
): Promise<ChannelPreferences> => {
  // Organization mandatory notices are policy, not preference. Never consult
  // a property-scoped preference row for them: both channels are always on
  // and email is always immediate.
  if (category === 'mandatory') {
    return {
      inAppEnabled: true,
      emailEnabled: true,
      emailCadence: 'immediate',
    }
  }
  // ADR 0059: an Organization-scoped informational notice has no Property and
  // therefore no preference row. ADR 0046 rule 1 says missing rows resolve
  // through versioned defaults — so in-app follows the category default, and
  // email is off outright: there is no row that could ever opt it in, and the
  // email queue's own scope CHECK would refuse it. A Property-scoped type that
  // fell back to the Organization for want of a Property is decided the same.
  if (isOrganizationScopedNotice(input.type, input.propertyId)) {
    return {
      inAppEnabled: getDefaultEnabled(category, 'in_app'),
      emailEnabled: false,
      emailCadence: getDefaultCadence(category),
    }
  }
  if (input.propertyId === null) {
    throw new TypeError('Property-scoped notification requires propertyId')
  }
  // The Property's own row, else the person's default for the category, else
  // ADR 0046 r.1's versioned defaults. A Property added or reassigned since
  // the person last configured anything now inherits their default instead of
  // falling through to "urgent email, immediately".
  const [inApp, email] = await Promise.all([
    deps.preferenceRepo.resolveForDelivery(
      input.userId,
      input.organizationId,
      input.propertyId,
      category,
      'in_app',
    ),
    deps.preferenceRepo.resolveForDelivery(
      input.userId,
      input.organizationId,
      input.propertyId,
      category,
      'email',
    ),
  ])
  return {
    inAppEnabled: inApp.enabled,
    emailEnabled: email.enabled,
    emailCadence: email.cadence,
  }
}

// ── Low ratings ─────────────────────────────────────────────────────

/** Which channels a Low ratings notice reaches its reader on (ADR 0046, amended 2026-09-30). */
type LowRatingRoute = Readonly<{
  inApp: boolean
  email: boolean
  emailCadence: NotificationCadence
}>

/** The rating a rated notice goes by: private feedback's own, a review's from Review. */
const ratingOf = async (
  deps: InsertNotificationDeps,
  input: InsertNotificationInput,
): Promise<number | null> => {
  if (input.type === 'feedback.created') {
    return parseNotificationPayload(input.payload).guestRating ?? null
  }
  if (input.resourceType !== 'inbox_item') return null
  return deps.ratingForRouting({
    organizationId: input.organizationId,
    inboxItemId: input.resourceId,
  })
}

const thresholdOf = (
  preference: CategoryPreferenceValues,
  channel: 'in_app' | 'email',
) => ({
  enabled: preference.enabled,
  maxRating: preference.maxRating ?? getDefaultMaxRating('low_ratings', channel) ?? 1,
})

/**
 * Whether a rated notice is a Low ratings one for THIS reader, and on which
 * channels: at or below their own threshold for each, from the Property's row,
 * else their default, else 3★ in the app and 2★ by email. Null when it is not
 * — not a rated type, no rating to go by (unrated feedback, or a Google review
 * past its cache window), or above both thresholds.
 */
const lowRatingRoute = async (
  deps: InsertNotificationDeps,
  input: InsertNotificationInput,
): Promise<LowRatingRoute | null> => {
  if (!RATED_NOTIFICATION_TYPES.has(input.type) || input.propertyId === null) return null
  const rating = await ratingOf(deps, input)
  if (rating === null) return null
  const [inApp, email] = await Promise.all(
    (['in_app', 'email'] as const).map((channel) =>
      deps.preferenceRepo.resolveForDelivery(
        input.userId,
        input.organizationId,
        input.propertyId!,
        'low_ratings',
        channel,
      ),
    ),
  )
  const route = {
    inApp: isLowFor(thresholdOf(inApp!, 'in_app'), rating),
    email: isLowFor(thresholdOf(email!, 'email'), rating),
    emailCadence: email!.cadence,
  }
  return route.inApp || route.email ? route : null
}

/**
 * A Low ratings notice's channels: each one it is low enough for, and — on a
 * channel it is not — the reader's New reviews and feedback answer, which
 * still stands for every review.
 */
const lowRatingChannels = async (
  deps: InsertNotificationDeps,
  input: InsertNotificationInput,
  route: LowRatingRoute,
): Promise<ChannelPreferences> => {
  const arrivals = await resolveChannelPreferences(deps, input, 'arrivals')
  return {
    inAppEnabled: route.inApp || arrivals.inAppEnabled,
    emailEnabled: route.email || arrivals.emailEnabled,
    emailCadence: route.email ? route.emailCadence : arrivals.emailCadence,
  }
}

// ── Email-queue enqueue ─────────────────────────────────────────────

/**
 * The idempotency key of a mandatory repeat's email: the event, per recipient.
 * It leads with `event:` so the delivery-lag report can tell it from a row's
 * own `${notificationId}:email` key and read the source event out of it.
 */
export const mandatoryRepeatEmailKey = (eventId: string, userId: string): string =>
  `event:${eventId}:${userId}:email`

const enqueueImmediateEmailBestEffort = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
  emailId: NotificationEmailId,
): Promise<void> => {
  if (!deps.enqueueImmediateEmail) return
  try {
    await deps.enqueueImmediateEmail({
      notificationEmailId: unbrand(emailId),
      organizationId: unbrand(notification.organizationId),
      ...(notification.propertyId === null
        ? {}
        : { propertyId: unbrand(notification.propertyId) }),
    })
  } catch (enqueueErr) {
    // `correlationId` is the same opaque string the urgent-email job envelope
    // carries, so this failure and the digest sweep's later re-enqueue join on
    // one field. No tenant/entity ids (BQC-7.3, see below). Recovery "depends
    // on" the sweep rather than being guaranteed by it: the sweep covers
    // Organization-scoped mandatory rows as well as Property-scoped ones, but
    // it is a no-op when outbound email is dark, when no queue is configured,
    // and for non-active properties.
    deps.logger.error(
      {
        err: enqueueErr,
        correlationId: `notification-email:${unbrand(emailId)}`,
        cadence: 'immediate',
      },
      'Immediate notification email enqueue failed — recovery depends on the digest sweep',
    )
  }
}

/**
 * A MANDATORY event that landed in an unread row another event created: a
 * second role change, a second purge-pending notice. ADR 0046 r.2 still
 * coalesces it in-app, but mandatory notices always go by email, so it gets an
 * email of its own. A replay of the row's own event is not a repeat.
 */
const isMandatoryRepeat = (
  anchor: DomainNotification,
  input: InsertNotificationInput,
): boolean => anchor.category === 'mandatory' && anchor.eventId !== input.eventId

/**
 * The email a row carries for the event that created it is keyed on the row.
 * A mandatory repeat's email is anchored on the same row but keyed on its own
 * event: the row's key would hand back the first event's, already-sent email.
 */
const emailKeyFor = (
  anchor: DomainNotification,
  input: InsertNotificationInput,
): string =>
  isMandatoryRepeat(anchor, input)
    ? mandatoryRepeatEmailKey(input.eventId, unbrand(input.userId))
    : `${unbrand(anchor.id)}:email`

// Create + persist the email-queue row. Urgent rows trigger an immediate
// delivery job; normal rows are left 'pending' for the daily digest.
const enqueueEmailEntry = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
  cadence: NotificationCadence,
  idempotencyKey: string,
  audience: NotificationAudience | null,
): Promise<void> => {
  const stop = await deps.organizationEmailStop(unbrand(notification.organizationId))
  if (isEmailStopped(stop, notification.category)) {
    deps.logger.info(
      { cadence, reason: ORGANIZATION_CLOSING_REASON },
      'Notification email not queued — the Organization is closing',
    )
    return
  }
  const emailResult = createNotificationEmail(
    {
      id: deps.emailIdGen(),
      notificationId: notification.id,
      userId: notification.userId,
      organizationId: notification.organizationId,
      propertyId: notification.propertyId,
      category: notification.category,
      cadence,
      priority: notification.priority,
      idempotencyKey,
      notBefore: null,
      // Kept so the send path can recheck the recipient's standing.
      recipientAudience: audience,
    },
    deps.clock,
  )
  if (emailResult.isErr()) {
    deps.logger.warn({ error: emailResult.error }, 'Failed to create email queue entry')
    return
  }

  const queued = await deps.emailRepo.insert(emailResult.value)
  if (cadence === 'immediate') {
    await enqueueImmediateEmailBestEffort(deps, notification, queued.id)
  }
}

/**
 * The row an email-only recipient gets: the email queue's anchor and nothing
 * else, stored already read. Unread, it held ADR 0046 r.2's unread
 * (user, type, resource) key while hidden from the feed, so the database
 * folded every later event on the resource into it and the email queue handed
 * back the first, already-sent entry. Read, it sits outside that key: each
 * event gets its own row, its own `${id}:email` idempotency key and its own
 * email, and turning in-app back on does not resurface it as unread.
 *
 * Nobody read it, so it carries no `readAt`. That is what keeps an actionable
 * anchor's email going out: the pre-send check holds back a notice its reader
 * read, and a read time here would have claimed a reading that never happened
 * (`isStillActionable`).
 */
const asEmailOnlyAnchor = (notification: DomainNotification): DomainNotification => ({
  ...notification,
  status: 'read',
  readAt: null,
})

/**
 * Retires the reader's own earlier notices this one takes over, and — unless
 * the rule keeps their email and this notice sends none — the emails still
 * queued behind them (`SUPERSEDED_FOR_READER`).
 */
const settleSupersededForReader = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
  channels: Readonly<{ shownInApp: boolean; sendsEmail: boolean }>,
): Promise<void> => {
  const rule = SUPERSEDED_FOR_READER[notification.type]
  if (rule === undefined || (rule.onlyWhenShownInApp && !channels.shownInApp)) return
  const resolvedAt = deps.clock()
  const settled = await deps.notificationRepo.settleUnreadForReader({
    organizationId: notification.organizationId,
    userId: notification.userId,
    types: rule.types,
    categories: rule.categories,
    inAppOnly: rule.keepsEmail,
    resourceId: notification.resourceId,
    resolvedAt,
  })
  if (settled.length === 0 || (rule.keepsEmail && !channels.sendsEmail)) return
  await deps.emailRepo.cancelQueuedForNotifications(
    settled,
    notification.organizationId,
    SETTLED_EMAIL_REASON,
    resolvedAt,
  )
}

// ── Use case ────────────────────────────────────────────────────────

export const insertNotification =
  (deps: InsertNotificationDeps) =>
  async (
    input: InsertNotificationInput,
    /** Why the recipient was admitted; stored with any queued email. */
    audience: NotificationAudience | null = null,
  ): Promise<DomainNotification | null> => {
    const { logger } = deps

    // 0. A rated notice may be a Low ratings one for this reader. Decided
    // before the entity is built, so its category and copy say so; only the
    // outcome is kept (`lowRating`), never the stars (ADR 0031).
    const lowRating = await lowRatingRoute(deps, input)
    const routed: InsertNotificationInput = lowRating
      ? {
          ...input,
          payload: { ...parseNotificationPayload(input.payload), lowRating: true },
        }
      : input

    // 1. Construct + validate the domain entity
    const result = createNotification({ ...routed, id: deps.idGen() }, deps.clock)
    if (result.isErr()) {
      // BQC-7.3: the raw input (tenant/entity ids) is never logged.
      logger.warn({ error: result.error }, 'Failed to construct notification')
      throw result.error
    }

    const { inAppEnabled, emailEnabled, emailCadence } = lowRating
      ? await lowRatingChannels(deps, routed, lowRating)
      : await resolveChannelPreferences(deps, routed, result.value.category)

    if (!inAppEnabled && !emailEnabled) {
      logger.info(
        { type: input.type },
        'Notification skipped — both in-app and email disabled by preference',
      )
      return null
    }

    // 2b. ADR 0046 r.2: at most one UNREAD row per (user, type, resource). A
    // repeat event ABSORBS into that row — count bumped, latest arrival
    // stamped, payload merged newest-wins, copy re-rendered from the merged
    // facts (so a row of three notes now reads "…3 notes added"). No second
    // email: the original queue entry still stands for the same resource —
    // except for a mandatory notice, which is mailed once per event
    // (`isMandatoryRepeat`). A settled row is not absorbed into: its work is
    // done and its email sent or cancelled, so a repeat is a new request and
    // falls through to a row and an email of its own. In-app only — an
    // email-only recipient has no unread row to absorb into, and their anchor
    // is stored read (step 3) so the database cannot absorb into it either.
    if (inAppEnabled) {
      const existing = await deps.notificationRepo.findUnreadByUserTypeResource(
        input.userId,
        input.organizationId,
        input.propertyId,
        input.type,
        input.resourceId,
      )
      if (existing) {
        const coalesced = applyCoalescence(existing, result.value.payload, deps.clock())
        // The bump only lands on a row that is still waiting. When a read,
        // dismiss or settlement committed after the lookup, the event is not
        // the user's old news: it falls through to a fresh unread row (step 3),
        // whose upsert re-coalesces atomically if yet another waiting row
        // appeared meanwhile.
        if (await deps.notificationRepo.refreshUnread(coalesced)) {
          if (emailEnabled && isMandatoryRepeat(coalesced, input)) {
            await enqueueEmailEntry(
              deps,
              coalesced,
              emailCadence,
              emailKeyFor(coalesced, input),
              audience,
            )
          }
          // A repeat still takes over what it takes over: a second "No
          // longer yours" folding into an unread first one must still retire
          // the "Assigned to you" written in between.
          await settleSupersededForReader(deps, coalesced, {
            shownInApp: true,
            sendsEmail: emailEnabled && isMandatoryRepeat(coalesced, input),
          })
          return coalesced
        }
      }
    }

    // 3. Persist the notification row (in-app anchor + email FK). The upsert
    // can still fold this event into an unread row that raced past the lookup;
    // `emailKeyFor` then treats it as the repeat it is.
    const inserted = await deps.notificationRepo.insert(
      inAppEnabled ? result.value : asEmailOnlyAnchor(result.value),
    )

    // 4. Enqueue the email-queue entry when the email channel is on
    if (emailEnabled) {
      await enqueueEmailEntry(
        deps,
        inserted,
        emailCadence,
        emailKeyFor(inserted, input),
        audience,
      )
    }

    // 4b. This notice takes over the reader's own earlier ones about the item.
    await settleSupersededForReader(deps, inserted, {
      shownInApp: inAppEnabled,
      sendsEmail: emailEnabled,
    })

    // 5. Return notification only if in-app channel is enabled
    if (!inAppEnabled) {
      logger.info(
        'Notification persisted for email only — not returned for in-app display',
      )
      return null
    }

    return inserted
  }

export type InsertNotification = typeof insertNotification
