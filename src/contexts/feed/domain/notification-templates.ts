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
//   4. Say HOW LONG something had waited when the notice was raised, where
//      it was waiting. The read measures it (`waitedHours`); it is a fact
//      beside the sentence (email facts line, in-app meta strip), never
//      inside it, and never an age that keeps growing after the fact.
//   5. One primary action, imperative, ≤ 3 words.
//   6. Degrade gracefully. Every field is optional; missing metadata must
//      shorten the sentence, never produce "undefined" or an empty title.
//
import { SUPPORT_EMAIL } from '#/shared/domain/support-contact'
import type {
  NotificationActorRole,
  NotificationPayload,
  NotificationReopenReason,
} from './notification-payload'
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
  /**
   * Email footer wording for a notice with no off switch, in this notice's own
   * words. Mandatory mail has no preferences link, so the footer is the only
   * place it can say why it arrived, and one generic sentence for every
   * account notice told a reader nothing. Absent for optional mail, whose
   * footer points at the preference it came from.
   */
  whyReceived?: string
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

/** Who acted, as the subject that opens a sentence. */
const ROLE_LABELS: Record<NotificationActorRole, string> = {
  account_admin: 'An account admin',
  property_manager: 'A property manager',
  staff: 'A team member',
}

/** " · Riverside Hotel" style suffix, or "" when the name is unknown. */
const atProperty = (payload: NotificationPayload): string =>
  payload.propertyName === undefined ? '' : ` at ${payload.propertyName}`

/**
 * "3h" / "2d": how long the item had waited when the notice was raised.
 * Returns "" when nothing was waiting, and below one hour so a fresh item gets
 * no "0h".
 */
export const waitingAge = ({ waitedHours: hours }: NotificationPayload): string => {
  if (hours === undefined || hours < 1) return ''
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

const byRole = (payload: NotificationPayload): string =>
  payload.actorRole === undefined ? 'Someone' : ROLE_LABELS[payload.actorRole]

/** Joins non-empty clauses with a single space. Keeps sentences clean when metadata is missing. */
const sentence = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' ')

/** Joins non-empty facts with a middot for the compact metadata line. */
const facts = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' · ')

/** The facts line, led by the Property. */
const factsAt = (p: NotificationPayload, ...parts: ReadonlyArray<string>): string =>
  facts(p.propertyName ?? '', ...parts)

/**
 * The sentence noun. A rating is a fact: the in-app strip shows it as stars
 * and email in its facts line (`ratedNoun`), so a sentence never restates it.
 */
const inboxNoun = (p: NotificationPayload): string =>
  p.platform === 'portal' ? 'feedback' : 'review'

/** Guest feedback in the facts line, with its locally collected rating. */
const ratedFeedback = (p: NotificationPayload): string =>
  p.guestRating === undefined ? 'feedback' : `${p.guestRating}-star feedback`

/**
 * The facts-line noun. Portal feedback may carry its locally collected
 * rating; a provider review never carries one.
 */
const ratedNoun = (p: NotificationPayload): string =>
  p.platform === 'portal' ? ratedFeedback(p) : 'review'

// ── Per-type renderers ──────────────────────────────────────────────
// Each returns copy that reads correctly with an EMPTY payload and gets
// sharper as metadata arrives.

/**
 * An account notice: its summary is its title, in the facts line's case.
 * Renderers call it rather than being built by it at module load, which would
 * make this module side-effectful and pull it into every chunk that imports
 * the Feed public API.
 */
const accountNotice = (
  title: string,
  body: string,
  whyReceived: string,
): RenderedNotification => ({
  title,
  body,
  actionLabel: 'Review account',
  summary: title.toLowerCase(),
  whyReceived,
})

const renderOrganizationAccessGranted = (): RenderedNotification =>
  accountNotice(
    'Organization access added',
    'Your account can now access this organization.',
    'You received this because your account was given access to an organization on Reputation Key.',
  )

const renderOrganizationRoleChanged = (): RenderedNotification =>
  accountNotice(
    'Organization role updated',
    'Your account permissions for this organization were updated.',
    'You received this because what your account may do in an organization on Reputation Key changed.',
  )

const renderOrganizationAccessRemoved = (): RenderedNotification =>
  accountNotice(
    'Organization access removed',
    'Your account no longer has access to this organization. If this seems unexpected, contact an account administrator.',
    'You received this because your access to an organization on Reputation Key ended.',
  )

/**
 * LIF-01 program bullet 5. Purge Pending has no timer: support begins the
 * irreversible purge, so deletion can start at any time and only support can
 * cancel it first. The subject leads with "deletion" so a 60-character clip
 * keeps it. No shipped page exposes pending-purge actions; the generic
 * Organization link still opens the profile, and the label says so.
 *
 * "Contact support" is only useful with a channel attached, so the body names
 * the monitored address and the email sets it as its reply-to
 * (`notificationReplyTo`). A reader in a mail client can then answer where
 * they are standing.
 */
const renderOrganizationPurgePending = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `Final notice: permanent deletion of ${p.organizationName ?? 'this organization'}`,
  body: `The recovery window has ended. Deletion can start at any time and permanently erases its properties, portals, reviews, replies and Inbox history. Only Reputation Key support can stop it, before it starts. To stop it, answer this email or write to ${SUPPORT_EMAIL} now.`,
  actionLabel: 'Open profile',
  summary: facts(p.organizationName ?? '', 'permanent deletion pending'),
  whyReceived:
    'You received this because you administer an organization that is scheduled for permanent deletion. It cannot be turned off.',
})

const renderReviewCreated = (p: NotificationPayload): RenderedNotification => ({
  title: `New ${'review'}${atProperty(p)}`,
  body: 'Open it to read the review and reply.',
  actionLabel: 'Read review',
  summary: factsAt(p, 'review'),
})

const renderReviewUpdated = (p: NotificationPayload): RenderedNotification => ({
  title: `Review updated${atProperty(p)}`,
  body: 'The guest changed their review. Open it to check the latest details.',
  actionLabel: 'Review update',
  summary: factsAt(p, 'updated review'),
})

// Always feedback, even when the item lookup failed and left no platform.
const renderFeedbackCreated = (p: NotificationPayload): RenderedNotification => ({
  title: `New guest feedback${atProperty(p)}`,
  body: 'Open it to read the feedback.',
  actionLabel: 'Read feedback',
  summary: factsAt(p, ratedFeedback(p)),
})

const renderReplyPendingApproval = (p: NotificationPayload): RenderedNotification => ({
  title: `Approve a reply${atProperty(p)}`,
  body: `${byRole(p)} drafted a reply to a ${'review'}. It stays unpublished until you approve it.`,
  actionLabel: 'Review reply',
  summary: factsAt(p, 'review'),
})

const renderReplyApproved = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply was approved${atProperty(p)}`,
  body: 'It is queued to publish to Google.',
  actionLabel: 'View reply',
  summary: factsAt(p, 'review'),
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
  summary: factsAt(p, 'review'),
})

const renderReplyPublished = (p: NotificationPayload): RenderedNotification => ({
  title: `Your reply is live on Google${atProperty(p)}`,
  body: 'Guests can see it now. No further action needed.',
  actionLabel: 'View reply',
  summary: factsAt(p, 'review'),
})

// `not_sent` includes an answered 429, so it says nothing was posted, as the
// Inbox's "Not published" copy does, not that nothing reached Google.
const PUBLISH_FAILURE_BODIES = {
  not_sent: 'Nothing was posted to Google, so it is safe to try again.',
  refused: 'Nothing was posted to Google. Check the Google connection, then try again.',
  unconfirmed: "RepKey won't send it twice. Open it to check.",
} as const

// A connection waiting for a fresh consent refuses every retry, and the
// author may not be the one allowed to reconnect it, so the copy says who can.
const renderReplyPublishNeedsReconnect = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `Reply not published${atProperty(p)}`,
  body: 'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry — the draft is saved.',
  actionLabel: 'Open reply',
  summary: factsAt(p, 'review', 'reconnect Google'),
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
    summary: factsAt(p, 'review', state),
  }
}

/**
 * An approved reply that was cancelled before Google saw it. Each cause takes
 * a different next step, so the cause decides the whole sentence: reconnect,
 * nothing to do here, write a new reply, or just look. The title never says
 * "your" — the same notice goes to the approvers who have to act on it.
 */
const PUBLICATION_CANCELLATION_BODIES = {
  disconnect:
    'The Google connection was disconnected before it went out. The draft is saved: reconnect Google, then approve it again.',
  policy:
    'This property can no longer publish to Google, so it was never sent. The draft is saved.',
  source_changed:
    'The guest changed their review, so the approved text was never sent. Open it to write a reply to the new review.',
  provider_truth:
    'A different reply is already live on Google, so this one was never sent. Open it to check.',
} as const

const renderReplyPublicationCancelled = (
  p: NotificationPayload,
): RenderedNotification => {
  const cause = p.publicationCancellationCause
  return {
    title: `Reply returned to draft${atProperty(p)}`,
    body:
      cause === undefined
        ? 'It was never sent to Google. Open it to see where it stands.'
        : PUBLICATION_CANCELLATION_BODIES[cause],
    actionLabel: cause === 'source_changed' ? 'Open review' : 'Open reply',
    summary: factsAt(p, 'review', 'returned to draft'),
  }
}

/** The shared close of a notice that asks the reader to look, not to act. */
const SEE_WHERE = 'Open it to see where it stands.'

/**
 * Escalation is a manual call with no reason field, and an answered or closed
 * item can be escalated too. So the copy says who asked for attention and
 * nothing about why, or about the item being unanswered.
 */
const renderInboxEscalated = (p: NotificationPayload): RenderedNotification => ({
  title: `Escalated: ${inboxNoun(p)}${atProperty(p)}`,
  body: `${byRole(p)} escalated this for your attention. ${SEE_WHERE}`,
  actionLabel: 'Open item',
  summary: factsAt(p, ratedNoun(p), 'escalated'),
})

// The words below follow the glossary and the Inbox thread: an escalation is
// "resolved", an item is "reopened", a note is an Internal Note, and private
// feedback is handled, never replied to. "Follow-up" is the Inbox's word for a
// feedback outcome, so no notice uses it for anything else.

const renderInboxEscalationResolved = (p: NotificationPayload): RenderedNotification => ({
  title: `Escalation resolved${atProperty(p)}`,
  body: `This item is no longer escalated. ${SEE_WHERE}`,
  actionLabel: 'View item',
  summary: factsAt(p, 'escalation resolved'),
})

/**
 * Why the item is open again, in the reader's terms. The fact is the event's
 * own closed enum, never the free-text explanation beside it. `other` has no
 * sentence of its own — the manager chose not to say — so it falls back to
 * the generic clause, as does a row recorded before the reason was passed.
 */
const REOPEN_REASON_CLAUSES: Partial<Record<NotificationReopenReason, string>> = {
  guest_follow_up_still_needed: 'The guest still needs a follow-up.',
  internal_follow_up_still_needed: 'The team still needs a follow-up.',
  new_information: 'New information came in.',
  correcting_handling_status: 'Its handling status was wrong.',
  provider_reply_deleted: 'The published reply was removed from Google.',
  provider_reply_diverged: 'The reply on Google is no longer the one published.',
}

const renderInboxReopened = (p: NotificationPayload): RenderedNotification => ({
  title: `Reopened: ${inboxNoun(p)}${atProperty(p)}`,
  body: sentence(
    (p.reopenReason === undefined ? undefined : REOPEN_REASON_CLAUSES[p.reopenReason]) ??
      `This ${inboxNoun(p)} needs another look.`,
    SEE_WHERE,
  ),
  actionLabel: 'View item',
  summary: factsAt(p, ratedNoun(p), 'reopened'),
})

/** "an item" / "7 items" for the grouped Inbox notices. */
const someItems = (count: number): string => (count === 1 ? 'an item' : `${count} items`)

/**
 * The grouped Inbox notices: "7 items reopened". `body` receives "an item" or
 * "7 items" to finish the sentence with.
 */
const renderInboxBulk = (
  p: NotificationPayload,
  outcome: string,
  body: (items: string) => string,
): RenderedNotification => {
  const count = p.itemCount ?? 1
  return {
    title: `${count} ${count === 1 ? 'item' : 'items'} ${outcome}${atProperty(p)}`,
    body: body(someItems(count)),
    actionLabel: 'Open Inbox',
    summary: factsAt(p, `${count} ${outcome}`),
  }
}

const renderInboxBulkReopened = (p: NotificationPayload): RenderedNotification =>
  renderInboxBulk(
    p,
    'reopened',
    (items) => `${byRole(p)} reopened ${items}. Open the Inbox to take a look.`,
  )

const renderResponseTargetHalfway = (p: NotificationPayload): RenderedNotification => ({
  title: `Halfway to the response target${atProperty(p)}`,
  body: 'This item is still open.',
  actionLabel: 'View item',
  summary: factsAt(p, ratedNoun(p), 'target halfway'),
})

const renderResponseTargetPassed = (p: NotificationPayload): RenderedNotification => ({
  title: `Response target passed${atProperty(p)}`,
  body: 'This item is still open. Review it and choose the next step when practical.',
  actionLabel: 'View item',
  summary: factsAt(p, ratedNoun(p), 'target passed'),
})

const renderInboxAssigned = (p: NotificationPayload): RenderedNotification => ({
  title: `Assigned to you: ${inboxNoun(p)}${atProperty(p)}`,
  body: `${byRole(p)} assigned this to you. The next step is yours.`,
  actionLabel: 'Open item',
  summary: factsAt(p, ratedNoun(p), 'assigned to you'),
})

const renderInboxBulkAssigned = (p: NotificationPayload): RenderedNotification =>
  renderInboxBulk(
    p,
    'assigned to you',
    (items) => `${byRole(p)} assigned ${items} to you. Open the Inbox to see your work.`,
  )

/**
 * A member's items were released, all at once, at one Property. The copy never
 * names them — ADR 0046 r.8 keeps other employees out of a payload — so it
 * says what is true for the reader: this work is theirs to place now.
 */
const renderAssignmentsReleased = (p: NotificationPayload): RenderedNotification =>
  renderInboxBulk(
    p,
    'left unassigned',
    (items) => `${items} at this property lost their assignee. Give them a new one.`,
  )

const renderNoteAdded = (p: NotificationPayload): RenderedNotification => ({
  title: `New internal note on ${p.platform === 'portal' ? 'feedback' : 'a review'}${atProperty(p)}`,
  body: `${byRole(p)} left a note on this item. Open it to read the thread.`,
  actionLabel: 'Read note',
  summary: factsAt(p, ratedNoun(p), 'internal note'),
})

const renderPortalResponsibilityNeeded = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `A portal${atProperty(p)} needs a responsible manager`,
  body: 'Choose an eligible manager so portal updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: factsAt(p, 'responsible manager needed'),
})

const renderPortalHealthAttention = (p: NotificationPayload): RenderedNotification => ({
  title: `A guest portal${atProperty(p)} may need attention`,
  body: 'Open its settings to see what changed and what to do next.',
  actionLabel: 'Review portal',
  summary: factsAt(p, 'Portal may need attention'),
})

const renderPropertyResponsibilityNeeded = (
  p: NotificationPayload,
): RenderedNotification => ({
  title: `${p.propertyName ?? 'A property'} needs a responsible manager`,
  body: 'Choose an eligible manager so property-wide updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: factsAt(p, 'responsible manager needed'),
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

/**
 * Somebody disconnected the Organization's Google account on purpose. The
 * copy never names them — ADR 0046 r.8 keeps other employees out of a payload
 * — so it says what stopped and where to look, and the reader's own feed is
 * the record that it happened. No Property: the connection is the
 * Organization's.
 */
const renderIntegrationGoogleDisconnected = (): RenderedNotification => ({
  title: 'Google was disconnected',
  body: 'Review updates and replies to Google have stopped for this organization. Reconnect it in Settings if that was not intended.',
  actionLabel: 'Review connection',
  summary: 'Google disconnected',
})

/** "Goal completed: Reply within 24h at Riverside Hotel". */
const goalTitle = (lead: string, p: NotificationPayload): string =>
  `${lead}${p.goalName === undefined ? '' : `: ${p.goalName}`}${atProperty(p)}`

const renderGoalCompleted = (p: NotificationPayload): RenderedNotification => ({
  title: goalTitle('Goal completed', p),
  body: 'It hit its target. Open the goal to see the numbers.',
  actionLabel: 'View progress',
  summary: factsAt(p, p.goalName ?? 'goal completed'),
})

const renderGoalResultRevised = (p: NotificationPayload): RenderedNotification => ({
  title: goalTitle('Goal result updated', p),
  body: 'A monthly result changed. Open the goal to see the current metrics.',
  actionLabel: 'View result',
  summary: factsAt(p, p.goalName ?? 'goal result updated'),
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
  'reply.publication_cancelled': renderReplyPublicationCancelled,
  'inbox.escalated': renderInboxEscalated,
  'inbox.escalation_resolved': renderInboxEscalationResolved,
  'inbox.reopened': renderInboxReopened,
  'inbox.bulk_reopened': renderInboxBulkReopened,
  'inbox.response_target_halfway': renderResponseTargetHalfway,
  'inbox.response_target_passed': renderResponseTargetPassed,
  'inbox.assigned': renderInboxAssigned,
  'inbox.bulk_assigned': renderInboxBulkAssigned,
  'inbox.assignments_released': renderAssignmentsReleased,
  'inbox_note.added': renderNoteAdded,
  'portal.responsibility_needed': renderPortalResponsibilityNeeded,
  'portal.health_attention': renderPortalHealthAttention,
  'property.responsibility_needed': renderPropertyResponsibilityNeeded,
  'integration.reauthorization_required': renderIntegrationReauthorizationRequired,
  'integration.google_disconnected': renderIntegrationGoogleDisconnected,
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
}

/**
 * Render the copy for a notification. Pure — same inputs, same output — so the
 * in-app list, the email worker, and the digest all agree.
 *
 * `occurrences > 1` ends the body with one repeat sentence, because a row that
 * coalesced three escalations should not read like one that fired once (ADR
 * 0046 r.2). The wait the notice was raised with ends the facts line email
 * shows; the in-app row shows it in its own strip.
 */
export const renderNotification = (
  type: NotificationType,
  payload: NotificationPayload,
): RenderedNotification => {
  const rendered = RENDERERS[type](payload)
  const age = waitingAge(payload)
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
    summary: facts(rendered.summary, age === '' ? '' : `waited ${age}`),
  }
}

/** A page of the row's Property, or the Property list for a row without one. */
const propertyLink = (
  propertyId: string | null,
  page: string,
  search: Readonly<Record<string, string>> = {},
): NotificationLink =>
  propertyId === null
    ? { path: '/properties', search: {} }
    : { path: `/properties/${propertyId}${page}`, search }

/**
 * The queue a grouped Inbox notice opens at its Property instead of one of its
 * items: an assignment the recipient's own work, a reopen every open item.
 */
const GROUPED_INBOX_QUEUES: Partial<Record<NotificationType, string>> = {
  'inbox.bulk_assigned': 'mine',
  'inbox.bulk_reopened': 'open',
  // Released items are nobody's, so the honest queue is every open item.
  'inbox.assignments_released': 'open',
}

/**
 * Deep link for a notification. Every action-oriented type is inbox-item keyed
 * (CONTEXT.md decision log), so the honest target is the inbox detail pane.
 * A grouped notice is the exception: it opens a queue at that Property, which
 * is what its copy promises, when the caller passes the notification `type`.
 *
 * Returned as `{ path, search }` rather than a string because TanStack Router
 * requires the typed form — passing `'/inbox?itemId=x'` as `to` silently fails
 * to apply the query.
 *
 * `propertyId` comes from the notification ROW, not from `resourceId`: a
 * `goal` notification stamps its monthly result as its resource, and the
 * previous builder used that id as a propertyId, producing a dead
 * `/properties/<id>` link.
 */
export const notificationLink = (
  resourceType: NotificationResourceType,
  resourceId: string,
  propertyId: string | null,
  type?: NotificationType,
): NotificationLink => {
  switch (resourceType) {
    case 'organization':
      return { path: '/settings/profile', search: {} }
    case 'inbox_item': {
      const queue = type && GROUPED_INBOX_QUEUES[type]
      return queue === undefined
        ? { path: '/inbox', search: { itemId: resourceId } }
        : {
            path: '/inbox',
            search: propertyId === null ? { queue } : { queue, propertyId },
          }
    }
    case 'reply':
      // Legacy rows only: pre-2026-07 reply notifications stamped a replyId,
      // which no longer resolves. Land on the inbox list rather than 404.
      return { path: '/inbox', search: {} }
    case 'goal':
      // The resource is the monthly result the notice reports; the Goals page
      // opens the goal it belongs to.
      return propertyLink(propertyId, '/goals', { result: resourceId })
    case 'badge':
      return propertyLink(propertyId, '')
    case 'portal':
      return propertyLink(propertyId, `/portals/${resourceId}`, { tab: 'settings' })
    case 'property':
      // The only Property notice asks for a manager, and the picker is here.
      return propertyLink(propertyId, '/settings/people')
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

/**
 * The address a reply to this notice should reach, or `null` to leave the
 * message unanswerable and keep the sending identity's own.
 *
 * Only the final deletion notice sets one: it is the single notice whose copy
 * asks the reader to contact a human, and in a mail client "reply" is the
 * shortest path they have. Every other notice is about work that is answered
 * in the product, where an inbound mailbox would only lose the thread.
 */
export const notificationReplyTo = (type: NotificationType): string | null =>
  type === 'account.organization_purge_pending' ? SUPPORT_EMAIL : null
