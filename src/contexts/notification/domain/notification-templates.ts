// Notification context — render-time copy templates.
//
// ONE renderer drives every surface: the in-app row, the urgent email, the
// digest line, and the email subject. Copy therefore cannot drift between
// channels, and fixing a sentence fixes it everywhere including rows already
// in the database (we render from `type` + `payload`, not from the stored
// string).
//
// Copy rules, derived from ADR 0046 r.8 and from what a hotel manager actually
// needs to decide whether to act:
//
//   1. NEVER an identifier. No UUIDs, no "Inbox item 61ed98fc-…". The whole
//      point of `resourceId` is that the deep link carries it silently.
//   2. Lead with the DECISION. "Approve this reply" beats "Reply pending
//      approval" — the title says what the reader must do.
//   3. Say WHERE and HOW BAD. Property name plus star rating are the two facts
//      that decide whether this is a 30-second job or a fire.
//   4. Say HOW LONG. `waitingHours` turns a queue item into an SLA breach.
//   5. One primary action, imperative, ≤ 3 words.
//   6. Degrade gracefully. Every field is optional; missing metadata must
//      shorten the sentence, never produce "undefined" or an empty title.
//
// `stars()` renders the rating as a word ("2-star"), not glyphs: ★★☆☆☆ reads
// as "black star black star white star…" to a screen reader and mangles in
// plain-text email. The UI draws its own glyphs from `payload.rating`.

import type { NotificationActorRole, NotificationPayload } from './notification-payload'
import type { NotificationResourceType, NotificationType } from './types'

/** What a rendered notification exposes to every channel. */
export type RenderedNotification = Readonly<{
  /** Short, imperative where an action is required. Never empty. */
  title: string
  /** One supporting sentence. Empty string when the title says everything. */
  body: string
  /** Primary action label, imperative, <= 3 words. */
  actionLabel: string
  /** Extra context line for email only (digest rows and the urgent preheader). */
  summary: string
}>

/** Deep-link target for a notification, resolved from resource + type. */
export type NotificationLink = Readonly<{
  /** Route path with params already substituted, no query string. */
  path: string
  /** Query parameters as a plain object, already decoded. */
  search: Readonly<Record<string, string>>
}>

const ROLE_LABELS: Record<NotificationActorRole, string> = {
  account_admin: 'an account admin',
  property_manager: 'a property manager',
  staff: 'a team member',
}

const capitalise = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1)

/** "2-star" / "" when the rating is absent. */
const stars = (payload: NotificationPayload): string =>
  payload.rating === undefined ? '' : `${payload.rating}-star`

/** " · Riverside Hotel" style suffix, or "" when the name is unknown. */
const atProperty = (payload: NotificationPayload): string =>
  payload.propertyName === undefined ? '' : ` at ${payload.propertyName}`

/**
 * "3h" / "2d" — compact age. Returns "" below one hour so fresh items do not
 * get a misleading "0h" badge.
 */
export const formatWaitingAge = (hours: number | undefined): string => {
  if (hours === undefined || hours < 1) return ''
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** "waiting 3h" clause, or "" when the item is fresh or unmeasured. */
const waitedFor = (payload: NotificationPayload): string => {
  const age = formatWaitingAge(payload.waitingHours)
  return age === '' ? '' : `Waiting ${age}.`
}

const byRole = (payload: NotificationPayload): string =>
  payload.actorRole === undefined ? 'Someone' : capitalise(ROLE_LABELS[payload.actorRole])

/** Joins non-empty clauses with a single space. Keeps sentences clean when metadata is missing. */
const sentence = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' ')

/** Joins non-empty facts with a middot for the compact metadata line. */
const facts = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' · ')

/** A review descriptor: "2-star review" or just "review". */
const reviewNoun = (payload: NotificationPayload): string =>
  sentence(stars(payload), 'review')

// ── Per-type renderers ──────────────────────────────────────────────
// Each returns copy that reads correctly with an EMPTY payload and gets
// sharper as metadata arrives.

const renderReviewCreated = (p: NotificationPayload): RenderedNotification => ({
  title: `New ${reviewNoun(p)}${atProperty(p)}`,
  body:
    p.rating !== undefined && p.rating <= 2
      ? 'A low rating needs a reply soon. Open it to draft one.'
      : 'Open it to read the review and reply.',
  actionLabel: 'Read review',
  summary: facts(p.propertyName ?? '', reviewNoun(p)),
})

const renderFeedbackCreated = (p: NotificationPayload): RenderedNotification => ({
  title: `New guest feedback${atProperty(p)}`,
  body: sentence(
    p.rating === undefined ? '' : `Rated ${p.rating} out of 5.`,
    'Open it to read the feedback.',
  ),
  actionLabel: 'Read feedback',
  summary: facts(p.propertyName ?? '', p.rating === undefined ? '' : `${p.rating}/5`),
})

const renderReplyPendingApproval = (p: NotificationPayload): RenderedNotification => ({
  title: `Approve a reply${atProperty(p)}`,
  body: sentence(
    `${byRole(p)} drafted a reply to a ${reviewNoun(p)}.`,
    'It stays unpublished until you approve it.',
    waitedFor(p),
  ),
  actionLabel: 'Review reply',
  summary: facts(
    p.propertyName ?? '',
    reviewNoun(p),
    formatWaitingAge(p.waitingHours) === ''
      ? ''
      : `waiting ${formatWaitingAge(p.waitingHours)}`,
  ),
})

const renderReplyApproved = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply was approved${atProperty(p)}`,
  body: 'It is queued to publish to Google.',
  actionLabel: 'View reply',
  summary: facts(p.propertyName ?? '', reviewNoun(p)),
})

const renderReplyRejected = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply needs changes${atProperty(p)}`,
  body: sentence(
    p.moderationReason === undefined
      ? 'It was sent back without a reason.'
      : `Reason: ${p.moderationReason}`,
    'Edit it and resubmit.',
  ),
  actionLabel: 'Edit reply',
  summary: facts(p.propertyName ?? '', reviewNoun(p)),
})

const renderReplyPublished = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply is live on Google${atProperty(p)}`,
  body: 'Guests can see it now. No further action needed.',
  actionLabel: 'View on review',
  summary: facts(p.propertyName ?? '', reviewNoun(p)),
})

const renderReplyPublishFailed = (p: NotificationPayload): RenderedNotification => ({
  title: `Reply failed to publish${atProperty(p)}`,
  body: sentence(
    `Google rejected the reply to a ${reviewNoun(p)}.`,
    'Open it and retry — the draft is saved.',
  ),
  actionLabel: 'Retry publish',
  summary: facts(p.propertyName ?? '', reviewNoun(p), 'publish failed'),
})

const renderInboxEscalated = (p: NotificationPayload): RenderedNotification => ({
  title: `Escalated: ${reviewNoun(p)}${atProperty(p)}`,
  body: sentence(
    'This was escalated because it has gone unanswered.',
    waitedFor(p),
    'It needs a reply now.',
  ),
  actionLabel: 'Respond now',
  summary: facts(
    p.propertyName ?? '',
    reviewNoun(p),
    formatWaitingAge(p.waitingHours) === ''
      ? 'escalated'
      : `unanswered ${formatWaitingAge(p.waitingHours)}`,
  ),
})

const renderInboxAssigned = (p: NotificationPayload): RenderedNotification => ({
  title: `Assigned to you: ${reviewNoun(p)}${atProperty(p)}`,
  body: sentence(`${byRole(p)} assigned this to you.`, 'You own the reply.'),
  actionLabel: 'Open item',
  summary: facts(p.propertyName ?? '', reviewNoun(p), 'assigned to you'),
})

const renderNoteAdded = (p: NotificationPayload): RenderedNotification => ({
  title: `New note on a ${reviewNoun(p)}${atProperty(p)}`,
  body: sentence(`${byRole(p)} left a note on this item.`, 'Open it to read the thread.'),
  actionLabel: 'Read note',
  summary: facts(p.propertyName ?? '', reviewNoun(p), 'new note'),
})

const renderPortalResponsibilityNeeded = (): RenderedNotification => ({
  title: 'Portal needs a responsible manager',
  body: 'Choose an eligible manager so portal updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: 'responsible manager needed',
})

const renderGoalCompleted = (p: NotificationPayload): RenderedNotification => ({
  title:
    p.goalName === undefined
      ? `Goal completed${atProperty(p)}`
      : `Goal completed: ${p.goalName}`,
  body: sentence(
    p.propertyName === undefined ? '' : `${p.propertyName} hit its target.`,
    'Open the property to see the numbers.',
  ),
  actionLabel: 'View progress',
  summary: facts(p.propertyName ?? '', p.goalName ?? 'goal completed'),
})

const renderBadgeAwarded = (p: NotificationPayload): RenderedNotification => {
  const badge = p.badgeName ?? 'a badge'
  const target =
    p.recipientName ?? (p.targetKind === 'portal_group' ? 'A team' : 'A portal')
  return {
    title: `${target} earned ${badge}`,
    body: sentence(
      p.propertyName === undefined ? '' : `Awarded at ${p.propertyName}.`,
      'Open recognition to see the award.',
    ),
    actionLabel: 'View award',
    summary: facts(p.propertyName ?? '', badge),
  }
}

const RENDERERS: Record<
  NotificationType,
  (payload: NotificationPayload) => RenderedNotification
> = {
  'review.created': renderReviewCreated,
  'feedback.created': renderFeedbackCreated,
  'reply.pending_approval': renderReplyPendingApproval,
  'reply.approved': renderReplyApproved,
  'reply.rejected': renderReplyRejected,
  'reply.published': renderReplyPublished,
  'reply.publish_failed': renderReplyPublishFailed,
  'inbox.escalated': renderInboxEscalated,
  'inbox.assigned': renderInboxAssigned,
  'inbox_note.added': renderNoteAdded,
  'portal.responsibility_needed': renderPortalResponsibilityNeeded,
  'goal.completed': renderGoalCompleted,
  'badge.awarded': renderBadgeAwarded,
}

/**
 * Render the copy for a notification. Pure — same inputs, same output — so the
 * in-app list, the email worker, and the digest all agree.
 *
 * `occurrences > 1` appends a repeat marker, because a row that coalesced three
 * escalations should not read identically to one that fired once (ADR 0046 r.2).
 */
export const renderNotification = (
  type: NotificationType,
  payload: NotificationPayload,
): RenderedNotification => {
  const rendered = RENDERERS[type](payload)
  const repeats = payload.occurrences ?? 1
  if (repeats <= 1) return rendered
  return {
    ...rendered,
    body: sentence(rendered.body, `Updated ${repeats} times.`),
    summary: facts(rendered.summary, `${repeats}x`),
  }
}

/**
 * Deep link for a notification. Every action-oriented type is inbox-item keyed
 * (CONTEXT.md decision log), so the honest target is the inbox detail pane.
 *
 * Returned as `{ path, search }` rather than a string because TanStack Router
 * requires the typed form — passing `'/inbox?itemId=x'` as `to` silently fails
 * to apply the query.
 *
 * `propertyId` comes from the notification ROW, not from `resourceId`: a
 * `goal` notification stamps the goalId as its resource, and the previous
 * builder used that goalId as a propertyId, producing a dead
 * `/properties/<goalId>` link.
 */
export const notificationLink = (
  resourceType: NotificationResourceType,
  resourceId: string,
  propertyId: string,
): NotificationLink => {
  switch (resourceType) {
    case 'inbox_item':
      return { path: '/inbox', search: { itemId: resourceId } }
    case 'reply':
      // Legacy rows only: pre-2026-07 reply notifications stamped a replyId,
      // which no longer resolves. Land on the inbox list rather than 404.
      return { path: '/inbox', search: {} }
    case 'goal':
      return { path: `/properties/${propertyId}`, search: {} }
    case 'badge':
      return { path: '/settings/recognition', search: {} }
    case 'portal':
      return {
        path: `/properties/${propertyId}/portals/${resourceId}`,
        search: { tab: 'settings' },
      }
  }
}
