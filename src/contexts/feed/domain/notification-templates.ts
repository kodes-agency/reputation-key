// Feed notification surface — render-time copy templates.
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
//   4. Say HOW LONG, where something is still waiting. `waitingSince` is an
//      instant measured when the copy is read, so it is a fact beside the
//      sentence (email facts line, in-app meta strip), never inside it.
//   5. One primary action, imperative, ≤ 3 words.
//   6. Degrade gracefully. Every field is optional; missing metadata must
//      shorten the sentence, never produce "undefined" or an empty title.
//
import type { NotificationActorRole, NotificationPayload } from './notification-payload'
import type { NotificationResourceType, NotificationType } from './notification-types'

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
  /** Optional fragment, without `#`, for a target that is not a route. */
  hash?: string
}>

/** Opens the Feedback dialog on "Your reports" from anywhere in the app. */
export const BETA_FEEDBACK_REPORTS_ANCHOR = 'beta-feedback-reports'

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

const MS_PER_HOUR = 3_600_000

/**
 * "3h" / "2d": how long the current wait has lasted at `now`. Returns "" when
 * nothing is waiting, and below one hour so a fresh item gets no "0h".
 */
export const waitingAge = (payload: NotificationPayload, now: Date): string => {
  if (payload.waitingSince === undefined) return ''
  const hours = Math.floor(
    (now.getTime() - Date.parse(payload.waitingSince)) / MS_PER_HOUR,
  )
  if (hours < 1) return ''
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
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

/**
 * LIF-01 program bullet 5. Purge Pending has no timer: support begins the
 * irreversible purge, so deletion can start at any time and only support can
 * cancel it first. The subject leads with "deletion" so a 60-character clip
 * keeps it. No shipped page exposes pending-purge actions; the generic
 * Organization link still opens the profile, and the label says so.
 */
const renderOrganizationPurgePending = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `Final notice: permanent deletion of ${p.organizationName ?? 'this organization'}`,
  body: 'The recovery window has ended. Deletion can start at any time and permanently erases its properties, portals, reviews, replies and Inbox history. Only RepKey support can stop it, and only before it starts. Contact support now.',
  actionLabel: 'Open profile',
  summary: facts(p.organizationName ?? '', 'permanent deletion pending'),
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
  body: `${byRole(p)} drafted a reply to a ${reviewNoun()}. It stays unpublished until you approve it.`,
  actionLabel: 'Review reply',
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

const renderReplyApproved = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply was approved${atProperty(p)}`,
  body: 'It is queued to publish to Google.',
  actionLabel: 'View reply',
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

/**
 * The approver's reason never enters a notification (ADR 0030); only whether
 * there is one does. The flag outranks a quoted reason, which only historical
 * rows carry, because a coalesced row's flag describes the latest rejection.
 * With neither, the copy must not claim the reason is there or missing.
 */
const rejectionReasonBody = (p: NotificationPayload): string => {
  if (p.hasModerationReason === true) {
    return 'The approver left a reason. Open the reply to read it, then edit and resubmit.'
  }
  if (p.hasModerationReason === false) {
    return 'It was sent back without a reason. Edit it and resubmit.'
  }
  if (p.moderationReason !== undefined) {
    return sentence(`Reason: ${p.moderationReason}`, 'Edit it and resubmit.')
  }
  return 'Open it to see any note from the approver, then edit and resubmit.'
}

const renderReplyRejected = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply needs changes${atProperty(p)}`,
  body: rejectionReasonBody(p),
  actionLabel: 'Edit reply',
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

const renderReplyPublished = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply is live on Google${atProperty(p)}`,
  body: 'Guests can see it now. No further action needed.',
  actionLabel: 'View on review',
  summary: facts(p.propertyName ?? '', reviewNoun()),
})

const PUBLISH_FAILURE_BODIES = {
  not_sent: 'Nothing reached Google, so it is safe to try again.',
  refused: 'Nothing was posted to Google. Check the Google connection, then try again.',
  unconfirmed:
    "RepKey couldn't confirm it on Google and won't send it twice. Open it to check.",
} as const

// A connection waiting for a fresh consent refuses every retry, and the
// author may not be the one allowed to reconnect it, so the copy says who can.
const renderReplyPublishNeedsReconnect = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `Reply not published${atProperty(p)}`,
  body: 'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry — the draft is saved.',
  actionLabel: 'Open reply',
  summary: facts(p.propertyName ?? '', reviewNoun(), 'reconnect Google'),
})

/**
 * One fact covers every way a publication ends without a confirmed live
 * reply, and Google never saw most of them, so the copy follows the outcome
 * and never says Google rejected it. A reply that may be live gets no retry;
 * neither does a row too old to say. When the remedy is reconnecting Google,
 * that cause decides the copy instead: a retry alone cannot succeed. It can
 * reach a responsible manager instead of the author, so it never says "your".
 */
const renderReplyPublishFailed = (p: NotificationPayload): RenderedNotification => {
  if (p.publishFailureCause === 'google_reauthorization_required') {
    return renderReplyPublishNeedsReconnect(p)
  }
  const outcome = p.publishOutcome
  const state = outcome === 'unconfirmed' ? 'not confirmed' : 'not published'
  return {
    title: `Reply ${state}${outcome === 'unconfirmed' ? ' on Google' : ''}${atProperty(p)}`,
    body:
      outcome === undefined
        ? 'Open the reply to see where it stands.'
        : PUBLISH_FAILURE_BODIES[outcome],
    actionLabel:
      outcome === 'not_sent' || outcome === 'refused' ? 'Retry publish' : 'View reply',
    summary: facts(p.propertyName ?? '', reviewNoun(), state),
  }
}

/**
 * Escalation is a manual call with no reason field, and an answered or closed
 * item can be escalated too. So the copy says who asked for attention and
 * nothing about why, or about the item being unanswered.
 */
const renderInboxEscalated = (p: NotificationPayload): RenderedNotification => ({
  title: `Escalated: ${inboxNoun(p)}${atProperty(p)}`,
  body: `${byRole(p)} escalated this for your attention. Open it to see where it stands.`,
  actionLabel: 'Open item',
  summary: facts(p.propertyName ?? '', inboxNoun(p), 'escalated'),
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

const renderInboxBulkReopened = (p: NotificationPayload): RenderedNotification => {
  const count = p.itemCount ?? 1
  return {
    title:
      count === 1
        ? `Follow-up reopened${atProperty(p)}`
        : `${count} follow-ups reopened${atProperty(p)}`,
    body: sentence(
      `${byRole(p)} reopened ${count === 1 ? 'an item' : `${count} items`}.`,
      'Open the Inbox to review the latest status.',
    ),
    actionLabel: 'Open Inbox',
    summary: facts(p.propertyName ?? '', `${count} reopened`),
  }
}

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

const renderPortalResponsibilityNeeded = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `A portal${atProperty(p)} needs a responsible manager`,
  body: 'Choose an eligible manager so portal updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: facts(p.propertyName ?? '', 'responsible manager needed'),
})

const renderPortalHealthAttention = (p: NotificationPayload): RenderedNotification => ({
  title: `A guest portal${atProperty(p)} may need attention`,
  body: 'Open its settings to review what changed and the available next steps.',
  actionLabel: 'Review portal',
  summary: facts(p.propertyName ?? '', 'Portal may need attention'),
})

const renderPropertyResponsibilityNeeded = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `${p.propertyName ?? 'A property'} needs a responsible manager`,
  body: 'Choose an eligible manager so property-wide updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: facts(p.propertyName ?? '', 'responsible manager needed'),
})

/**
 * The Google connection belongs to the Organization. The Property its notice
 * is filed under is only a delivery anchor, so the copy never names it.
 *
 * When Google refused the grant itself, updates and replies have already
 * stopped, so the copy says so and leads with the one action that restores
 * them.
 */
const renderIntegrationReauthorizationRequired = (
  p: NotificationPayload,
): RenderedNotification =>
  p.reauthorizationCause === 'provider_revoked'
    ? {
        title: 'Reconnect Google',
        body: 'Google no longer accepts RepKey\u2019s access, so review updates and replies are paused.',
        actionLabel: 'Reconnect Google',
        summary: 'Google access ended',
      }
    : {
        title: 'Google connection needs attention',
        body: 'Reconnect the account to keep Google review updates and replies working.',
        actionLabel: 'Review connection',
        summary: 'Google connection needs attention',
      }

/** "Goal completed: Reply within 24h at Riverside Hotel". */
const goalTitle = (lead: string, p: NotificationPayload): string =>
  `${lead}${p.goalName === undefined ? '' : `: ${p.goalName}`}${atProperty(p)}`

const renderGoalCompleted = (p: NotificationPayload): RenderedNotification => ({
  title: goalTitle('Goal completed', p),
  body: 'It hit its target. Open the property to see the numbers.',
  actionLabel: 'View progress',
  summary: facts(p.propertyName ?? '', p.goalName ?? 'goal completed'),
})

const renderGoalResultRevised = (p: NotificationPayload): RenderedNotification => ({
  title: goalTitle('Goal result updated', p),
  body: 'A monthly result changed. Open the property to see the current metrics.',
  actionLabel: 'View result',
  summary: facts(p.propertyName ?? '', p.goalName ?? 'goal result updated'),
})

/**
 * The recipient's own beta report reached an outcome. The copy never quotes
 * the report — its words live in monitoring only — so it says what happened
 * and sends the reporter to their list, which knows which report it was.
 * Missing outcome degrades to a neutral update rather than guessing one.
 */
const REPORT_OUTCOME_COPY = {
  accepted: ['Your report was accepted', 'It will be worked on.'],
  declined: [
    'Your report won\u2019t be taken forward',
    'The team decided not to act on it.',
  ],
  resolved: ['Your report was resolved', 'It has been dealt with.'],
} as const

// Kept terse on purpose: templates render synchronously in the bell, so this
// copy ships in the initial bundle, which has almost no headroom.
const renderBetaFeedbackOutcome = (p: NotificationPayload): RenderedNotification => {
  const [title, body] =
    p.reportOutcome === undefined
      ? ['Your report was updated', 'See where it got to.']
      : REPORT_OUTCOME_COPY[p.reportOutcome]
  return { title, body, actionLabel: 'View reports', summary: title.slice(5) }
}

const RENDERERS: Record<
  NotificationType,
  (payload: NotificationPayload) => RenderedNotification
> = {
  'account.organization_access_granted': renderOrganizationAccessGranted,
  'account.organization_role_changed': renderOrganizationRoleChanged,
  'account.organization_access_removed': renderOrganizationAccessRemoved,
  'account.organization_purge_pending': renderOrganizationPurgePending,
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
  'inbox.bulk_reopened': renderInboxBulkReopened,
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
  'beta_feedback.outcome': renderBetaFeedbackOutcome,
}

/**
 * How a coalesced row says it repeated, with the verb for what repeated; `#`
 * is the count, the first event included. Types without one say only that it
 * happened again, which is true of all of them.
 */
const REPEATED: Partial<Record<NotificationType, string>> = {
  'inbox_note.added': '# notes added.',
  'inbox.escalated': 'Escalated # times.',
  'review.updated': 'Updated # times.',
  'reply.pending_approval': 'Submitted # times.',
}

/**
 * Render the copy for a notification. Pure — same inputs, same output — so the
 * in-app list, the email worker, and the digest all agree.
 *
 * `occurrences > 1` ends the body with one repeat sentence, because a row that
 * coalesced three escalations should not read like one that fired once (ADR
 * 0046 r.2). `now`, which email passes, adds the live waiting age to the facts
 * line; the in-app row shows it in its own strip.
 */
export const renderNotification = (
  type: NotificationType,
  payload: NotificationPayload,
  now?: Date,
): RenderedNotification => {
  const rendered = RENDERERS[type](payload)
  const age = now === undefined ? '' : waitingAge(payload, now)
  const repeats = payload.occurrences ?? 1
  return {
    ...rendered,
    body:
      repeats > 1
        ? sentence(
            rendered.body,
            (REPEATED[type] ?? 'This happened # times.').replace('#', `${repeats}`),
          )
        : rendered.body,
    summary: facts(rendered.summary, age === '' ? '' : `waiting ${age}`),
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
    case 'beta_feedback_report':
      // A report lives in the Feedback dialog, which every authenticated page
      // carries, not on a route. The hash opens it on "Your reports"; a hash
      // rather than a search param because no route's search schema has to
      // admit it. `/properties` because that is where `/` lands.
      return { path: '/properties', search: {}, hash: BETA_FEEDBACK_REPORTS_ANCHOR }
  }
}
