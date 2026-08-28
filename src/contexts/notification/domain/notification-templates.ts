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
//   3. Say WHERE. A locally collected guest rating may add context to Portal
//      feedback, but Google/provider ratings never enter Notification storage.
//   4. Say HOW LONG. `waitingHours` turns a queue item into an SLA breach.
//   5. One primary action, imperative, ≤ 3 words.
//   6. Degrade gracefully. Every field is optional; missing metadata must
//      shorten the sentence, never produce "undefined" or an empty title.
//
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

/** Provider review copy is intentionally rating-free. */
const reviewNoun = (): string => 'review'

/** Portal feedback may carry the locally collected private rating. */
const inboxNoun = (payload: NotificationPayload): string =>
  payload.platform === 'portal'
    ? sentence(
        payload.guestRating === undefined ? '' : `${payload.guestRating}-star`,
        'feedback',
      )
    : reviewNoun()

// ── Per-type renderers ──────────────────────────────────────────────
// Each returns copy that reads correctly with an EMPTY payload and gets
// sharper as metadata arrives.

const renderOrganizationAccessGranted = (): RenderedNotification => ({
  title: 'Organization access added',
  body: 'Your account can now access this organization.',
  actionLabel: 'Review account',
  summary: 'organization access added',
})

const renderOrganizationRoleChanged = (): RenderedNotification => ({
  title: 'Organization role updated',
  body: 'Your account permissions for this organization were updated.',
  actionLabel: 'Review account',
  summary: 'organization role updated',
})

const renderOrganizationAccessRemoved = (): RenderedNotification => ({
  title: 'Organization access removed',
  body: 'Your account no longer has access to this organization. If this seems unexpected, contact an account administrator.',
  actionLabel: 'Review account',
  summary: 'organization access removed',
})

const renderReviewCreated = (p: NotificationPayload): RenderedNotification => ({
  title: `New ${reviewNoun()}${atProperty(p)}`,
  body: 'Open it to read the review and reply.',
  actionLabel: 'Read review',
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

const renderReviewUpdated = (p: NotificationPayload): RenderedNotification => ({
  title: `Review updated${atProperty(p)}`,
  body: 'The guest changed their review. Open it to check the latest details.',
  actionLabel: 'Review update',
  summary: facts(p.propertyName ?? '', 'updated review'),
})

const renderFeedbackCreated = (p: NotificationPayload): RenderedNotification => ({
  title: `New guest feedback${atProperty(p)}`,
  body: sentence(
    p.guestRating === undefined ? '' : `Rated ${p.guestRating} out of 5.`,
    'Open it to read the feedback.',
  ),
  actionLabel: 'Read feedback',
  summary: facts(
    p.propertyName ?? '',
    p.guestRating === undefined ? '' : `${p.guestRating}-star feedback`,
  ),
})

const renderReplyPendingApproval = (p: NotificationPayload): RenderedNotification => ({
  title: `Approve a reply${atProperty(p)}`,
  body: sentence(
    `${byRole(p)} drafted a reply to a ${reviewNoun()}.`,
    'It stays unpublished until you approve it.',
    waitedFor(p),
  ),
  actionLabel: 'Review reply',
  summary: facts(
    p.propertyName ?? '',
    reviewNoun(),
    formatWaitingAge(p.waitingHours) === ''
      ? ''
      : `waiting ${formatWaitingAge(p.waitingHours)}`,
  ),
})

const renderReplyApproved = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply was approved${atProperty(p)}`,
  body: 'It is queued to publish to Google.',
  actionLabel: 'View reply',
  summary: facts(p.propertyName ?? '', reviewNoun()),
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
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

const renderReplyPublished = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply is live on Google${atProperty(p)}`,
  body: 'Guests can see it now. No further action needed.',
  actionLabel: 'View on review',
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

const renderReplyPublishFailed = (p: NotificationPayload): RenderedNotification => ({
  title: `Reply failed to publish${atProperty(p)}`,
  body: sentence(
    `Google rejected the reply to a ${reviewNoun()}.`,
    'Open it and retry — the draft is saved.',
  ),
  actionLabel: 'Retry publish',
  summary: facts(p.propertyName ?? '', reviewNoun(), 'publish failed'),
})

const renderInboxEscalated = (p: NotificationPayload): RenderedNotification => ({
  title: `Escalated: ${inboxNoun(p)}${atProperty(p)}`,
  body: sentence(
    'This was escalated because it has gone unanswered.',
    waitedFor(p),
    'It needs a reply now.',
  ),
  actionLabel: 'Respond now',
  summary: facts(
    p.propertyName ?? '',
    inboxNoun(p),
    formatWaitingAge(p.waitingHours) === ''
      ? 'escalated'
      : `unanswered ${formatWaitingAge(p.waitingHours)}`,
  ),
})

const renderInboxEscalationResolved = (p: NotificationPayload): RenderedNotification => ({
  title: `Follow-up updated${atProperty(p)}`,
  body: 'This item is no longer marked for extra attention. You can open it to review the latest status.',
  actionLabel: 'View item',
  summary: facts(p.propertyName ?? '', 'follow-up updated'),
})

const renderInboxReopened = (p: NotificationPayload): RenderedNotification => ({
  title: `Follow-up reopened${atProperty(p)}`,
  body: sentence(
    `This ${inboxNoun(p)} needs another look.`,
    'Open it to review the latest status.',
  ),
  actionLabel: 'View item',
  summary: facts(p.propertyName ?? '', inboxNoun(p), 'follow-up reopened'),
})

const renderResponseTargetHalfway = (p: NotificationPayload): RenderedNotification => ({
  title: `Response target is halfway${atProperty(p)}`,
  body: 'This item remains open. Open it when you are ready to continue the follow-up.',
  actionLabel: 'View item',
  summary: facts(p.propertyName ?? '', inboxNoun(p), 'target halfway'),
})

const renderResponseTargetPassed = (p: NotificationPayload): RenderedNotification => ({
  title: `Response target time has passed${atProperty(p)}`,
  body: 'This item remains open. Review it and choose the next step when practical.',
  actionLabel: 'View item',
  summary: facts(p.propertyName ?? '', inboxNoun(p), 'target time passed'),
})

const renderInboxAssigned = (p: NotificationPayload): RenderedNotification => ({
  title: `Assigned to you: ${inboxNoun(p)}${atProperty(p)}`,
  body: sentence(`${byRole(p)} assigned this to you.`, 'You own the reply.'),
  actionLabel: 'Open item',
  summary: facts(p.propertyName ?? '', inboxNoun(p), 'assigned to you'),
})

const renderInboxBulkAssigned = (p: NotificationPayload): RenderedNotification => {
  const count = p.itemCount ?? 1
  const noun = count === 1 ? 'Inbox item' : 'Inbox items'
  return {
    title: `${count} ${noun.toLowerCase()} assigned to you${atProperty(p)}`,
    body: sentence(
      `${byRole(p)} assigned ${count === 1 ? 'an item' : `${count} items`} to you.`,
      'Open the Inbox to review your work.',
    ),
    actionLabel: 'Open Inbox',
    summary: facts(p.propertyName ?? '', `${count} ${noun.toLowerCase()}`, 'assigned'),
  }
}

const renderNoteAdded = (p: NotificationPayload): RenderedNotification => ({
  title: `New note on ${inboxNoun(p)}${atProperty(p)}`,
  body: sentence(`${byRole(p)} left a note on this item.`, 'Open it to read the thread.'),
  actionLabel: 'Read note',
  summary: facts(p.propertyName ?? '', inboxNoun(p), 'new note'),
})

const renderPortalResponsibilityNeeded = (): RenderedNotification => ({
  title: 'Portal needs a responsible manager',
  body: 'Choose an eligible manager so portal updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: 'responsible manager needed',
})

const renderPortalHealthAttention = (p: NotificationPayload): RenderedNotification => ({
  title: `A guest portal${atProperty(p)} may need attention`,
  body: 'Open its settings to review what changed and the available next steps.',
  actionLabel: 'Review portal',
  summary: facts(p.propertyName ?? '', 'Portal may need attention'),
})

const renderPropertyResponsibilityNeeded = (): RenderedNotification => ({
  title: 'Property needs a responsible manager',
  body: 'Choose an eligible manager so property-wide updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: 'Property responsible manager needed',
})

const renderIntegrationReauthorizationRequired = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `Google connection needs attention${atProperty(p)}`,
  body: 'Reconnect the account to keep Google review updates and replies working.',
  actionLabel: 'Review connection',
  summary: facts(p.propertyName ?? '', 'Google connection needs attention'),
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

const renderGoalResultRevised = (p: NotificationPayload): RenderedNotification => ({
  title:
    p.goalName === undefined
      ? `Goal result updated${atProperty(p)}`
      : `Goal result updated: ${p.goalName}`,
  body: 'A monthly result changed. Open the property to see the current metrics.',
  actionLabel: 'View result',
  summary: facts(p.propertyName ?? '', p.goalName ?? 'goal result updated'),
})

const renderBadgeAwarded = (p: NotificationPayload): RenderedNotification => {
  const badge = p.badgeName
  const target =
    p.recipientName ?? (p.targetKind === 'portal_group' ? 'A portal group' : 'A portal')
  const location = p.propertyName === undefined ? '' : ` at ${p.propertyName}`
  return {
    title: badge === undefined ? 'Earlier award recorded' : `Earlier award: ${badge}`,
    body: sentence(
      `${target} received this award${location}.`,
      'This earlier update remains in your notification history.',
    ),
    actionLabel: 'View property',
    summary: facts(p.propertyName ?? '', badge ?? 'earlier award'),
  }
}

const RENDERERS: Record<
  NotificationType,
  (payload: NotificationPayload) => RenderedNotification
> = {
  'account.organization_access_granted': renderOrganizationAccessGranted,
  'account.organization_role_changed': renderOrganizationRoleChanged,
  'account.organization_access_removed': renderOrganizationAccessRemoved,
  'review.created': renderReviewCreated,
  'review.updated': renderReviewUpdated,
  'feedback.created': renderFeedbackCreated,
  'reply.pending_approval': renderReplyPendingApproval,
  'reply.approved': renderReplyApproved,
  'reply.rejected': renderReplyRejected,
  'reply.published': renderReplyPublished,
  'reply.publish_failed': renderReplyPublishFailed,
  'inbox.escalated': renderInboxEscalated,
  'inbox.escalation_resolved': renderInboxEscalationResolved,
  'inbox.reopened': renderInboxReopened,
  'inbox.response_target_halfway': renderResponseTargetHalfway,
  'inbox.response_target_passed': renderResponseTargetPassed,
  'inbox.assigned': renderInboxAssigned,
  'inbox.bulk_assigned': renderInboxBulkAssigned,
  'inbox_note.added': renderNoteAdded,
  'portal.responsibility_needed': renderPortalResponsibilityNeeded,
  'portal.health_attention': renderPortalHealthAttention,
  'property.responsibility_needed': renderPropertyResponsibilityNeeded,
  'integration.reauthorization_required': renderIntegrationReauthorizationRequired,
  'goal.completed': renderGoalCompleted,
  'goal.result_revised': renderGoalResultRevised,
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
  propertyId: string | null,
): NotificationLink => {
  switch (resourceType) {
    case 'organization':
      return { path: '/settings/profile', search: {} }
    case 'inbox_item':
      return { path: '/inbox', search: { itemId: resourceId } }
    case 'reply':
      // Legacy rows only: pre-2026-07 reply notifications stamped a replyId,
      // which no longer resolves. Land on the inbox list rather than 404.
      return { path: '/inbox', search: {} }
    case 'goal':
      return { path: `/properties/${propertyId}`, search: {} }
    case 'badge':
      return { path: `/properties/${propertyId}`, search: {} }
    case 'portal':
      return {
        path: `/properties/${propertyId}/portals/${resourceId}`,
        search: { tab: 'settings' },
      }
    case 'property':
      return { path: `/properties/${propertyId}/settings`, search: {} }
    case 'integration':
      return { path: '/settings/integrations', search: {} }
  }
}
