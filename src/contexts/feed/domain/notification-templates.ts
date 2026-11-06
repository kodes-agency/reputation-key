// Render copy from type and payload for in-app notifications, immediate mail
// and digests. Provider review stars and customer content stay out of payloads;
// missing metadata must shorten the copy without breaking its action or link.
import { SUPPORT_EMAIL } from '#/shared/domain/support-contact'
import {
  renderFeedbackCreated,
  renderReviewCreated,
  renderReviewImportFinished,
  renderReviewUpdated,
} from './notification-templates-arrival'
import {
  renderReplyApproved,
  renderReplyPublicationCancelled,
  renderReplyPublished,
  renderReplyPublishFailed,
  renderReplyRejected,
} from './notification-templates-reply'
import {
  renderInvitationAccepted,
  renderOrganizationAccessGranted,
  renderOrganizationAccessRemoved,
  renderOrganizationPropertyAccessChanged,
  renderOrganizationPurgePending,
  renderOrganizationRoleChanged,
} from './notification-templates-account'
import {
  renderGuestVoiceSummary,
  renderReviewAiUrgentDetected,
} from './notification-templates-guest-voice'
import {
  renderPortalGoalCompleted,
  renderPortalGoalResultRevised,
} from './notification-templates-portal-goal'
import {
  renderRatingGoalBelowPace,
  renderRatingGoalChanged,
  renderRatingGoalKeepDropped,
  renderRatingGoalReached,
  renderRatingGoalTooLow,
} from './notification-templates-rating-goal'
import type {
  NotificationActorRole,
  NotificationPayload,
  NotificationPortalHealthReason,
  NotificationPortalHealthStatus,
  NotificationReopenReason,
} from './notification-payload'
import type { NotificationResourceType, NotificationType } from './notification-types'

/**
 * What the reader's own clock is, for the one fact that only means anything
 * on it: a Response Target's target time. Copy stays English — this module is
 * the only place copy exists — so only the zone crosses. Absent on a surface
 * that cannot know it (the frozen snapshot written at insert time), and the
 * clause is then left out rather than guessed in UTC.
 */
export type NotificationRenderContext = Readonly<{ timeZone: string }>

/** What a rendered notification exposes to every channel. */
export type RenderedNotification = Readonly<{
  /** Short, imperative where an action is required. Never empty. */
  title: string
  /** One supporting sentence. Empty string when the title says everything. */
  body: string
  /**
   * What the in-app row shows under its title: the part of the body the title
   * and the row's facts line do not already say — a reason, a cause, a count,
   * a target time. Empty when the body only restates the title or says to open
   * the item, which the row itself is for. Never carries the repeat sentence:
   * the row shows how often a notice repeated as a fact.
   */
  detail: string
  /**
   * A notice that states several facts, one sentence each: the email lists them as
   * paragraphs instead of running them together (`body` is the same sentences in a row).
   * Absent for every notice that is one sentence.
   */
  lines?: readonly string[]
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

/** What a per-type renderer returns: `detail` defaults to "nothing to add". */
type RendererCopy = Omit<RenderedNotification, 'detail'> & Readonly<{ detail?: string }>

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

/** The shared close of a notice that asks the reader to look, not to act. */
const SEE_WHERE = 'Open it to see where it stands.'

const renderReplyPendingApproval = (p: NotificationPayload): RendererCopy => ({
  title: `Approve a reply${atProperty(p)}`,
  body: `${byRole(p)} drafted a reply to a ${'review'}. It stays unpublished until you approve it.`,
  actionLabel: 'Review reply',
  summary: factsAt(p, 'review'),
})

/**
 * Escalation is a manual call with no reason field, and an answered or closed
 * item can be escalated too. So the copy says who asked for attention and
 * nothing about why, or about the item being unanswered.
 */
const renderInboxEscalated = (p: NotificationPayload): RendererCopy => ({
  title: `Escalated: ${inboxNoun(p)}${atProperty(p)}`,
  body: `${byRole(p)} escalated this for your attention. ${SEE_WHERE}`,
  actionLabel: 'Open item',
  summary: factsAt(p, ratedNoun(p), 'escalated'),
})

// The words below follow the glossary and the Inbox thread: an escalation is
// "resolved", an item is "reopened", a note is an Internal Note, and private
// feedback is handled, never replied to. "Follow-up" is the Inbox's word for a
// feedback outcome, so no notice uses it for anything else.

const renderInboxEscalationResolved = (p: NotificationPayload): RendererCopy => ({
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
  // The reply on Google answered the review before the guest changed it.
  material_revision_changed: 'The guest changed their review after it was handled.',
}

const renderInboxReopened = (p: NotificationPayload): RendererCopy => {
  const reason =
    (p.reopenReason === undefined ? undefined : REOPEN_REASON_CLAUSES[p.reopenReason]) ??
    ''
  return {
    title: `Reopened: ${inboxNoun(p)}${atProperty(p)}`,
    body: sentence(
      reason === '' ? `This ${inboxNoun(p)} needs another look.` : reason,
      SEE_WHERE,
    ),
    detail: reason,
    actionLabel: 'View item',
    summary: factsAt(p, ratedNoun(p), 'reopened'),
  }
}

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
): RendererCopy => {
  const count = p.itemCount ?? 1
  return {
    title: `${count} ${count === 1 ? 'item' : 'items'} ${outcome}${atProperty(p)}`,
    body: body(someItems(count)),
    actionLabel: 'Open Inbox',
    summary: factsAt(p, `${count} ${outcome}`),
  }
}

const renderInboxBulkReopened = (p: NotificationPayload): RendererCopy =>
  renderInboxBulk(
    p,
    'reopened',
    (items) => `${byRole(p)} reopened ${items}. Open the Inbox to take a look.`,
  )

/** One formatter per timezone; the bell renders a page of rows at a time. */
const targetTimeFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * "Tue, Sep 29, 14:00" on the reader's clock. The weekday alone would be
 * ambiguous: an Organization policy may set a target up to 30 days out. Copy
 * is English everywhere in this module, so the label is formatted in en-GB
 * rather than the reader's language, and only the ZONE follows them.
 */
const targetTime = (
  p: NotificationPayload,
  context: NotificationRenderContext | undefined,
): string => {
  if (p.targetDueAt === undefined || context === undefined) return ''
  const at = Date.parse(p.targetDueAt)
  if (!Number.isFinite(at)) return ''
  let format = targetTimeFormatters.get(context.timeZone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: context.timeZone,
    })
    targetTimeFormatters.set(context.timeZone, format)
  }
  return format.format(at)
}

/** Halfway and passed share one shape; the words and the fact differ. */
const responseTargetNotice = (
  p: NotificationPayload,
  context: NotificationRenderContext | undefined,
  copy: Readonly<{ title: string; stillOpen: string; targetLead: string; fact: string }>,
): RendererCopy => {
  const at = targetTime(p, context)
  const target = at === '' ? '' : `${copy.targetLead} ${at}.`
  return {
    title: `${copy.title}${atProperty(p)}`,
    body: sentence(copy.stillOpen, target),
    detail: target,
    actionLabel: 'View item',
    summary: factsAt(p, ratedNoun(p), copy.fact),
  }
}

const renderResponseTargetHalfway = (
  p: NotificationPayload,
  context?: NotificationRenderContext,
): RendererCopy =>
  responseTargetNotice(p, context, {
    title: 'Halfway to the response target',
    stillOpen: 'This item is still open.',
    targetLead: 'Target time',
    fact: 'target halfway',
  })

const renderResponseTargetPassed = (
  p: NotificationPayload,
  context?: NotificationRenderContext,
): RendererCopy =>
  responseTargetNotice(p, context, {
    title: 'Response target passed',
    stillOpen:
      'This item is still open. Review it and choose the next step when practical.',
    targetLead: 'The target time was',
    fact: 'target passed',
  })

const renderInboxAssigned = (p: NotificationPayload): RendererCopy => ({
  title: `Assigned to you: ${inboxNoun(p)}${atProperty(p)}`,
  body: `${byRole(p)} assigned this to you. The next step is yours.`,
  actionLabel: 'Open item',
  summary: factsAt(p, ratedNoun(p), 'assigned to you'),
})

/**
 * The item moved to somebody else. This is news, not a task: it says the work
 * is off the reader's list, and never names who has it now — that is another
 * employee's data (ADR 0046 r.8).
 */
const renderInboxUnassigned = (p: NotificationPayload): RendererCopy => ({
  title: `No longer yours: ${inboxNoun(p)}${atProperty(p)}`,
  body: `${byRole(p)} passed this on. Somebody else is handling it now.`,
  actionLabel: 'View item',
  summary: factsAt(p, ratedNoun(p), 'reassigned'),
})

const renderInboxBulkAssigned = (p: NotificationPayload): RendererCopy =>
  renderInboxBulk(
    p,
    'assigned to you',
    (items) => `${byRole(p)} assigned ${items} to you. Open the Inbox to see your work.`,
  )

/** The grouped `inbox.unassigned`: it never names who holds the items now. */
const renderInboxBulkUnassigned = (p: NotificationPayload): RendererCopy =>
  renderInboxBulk(
    p,
    'no longer yours',
    (items) => `${byRole(p)} reassigned ${items} you held to somebody else.`,
  )

/**
 * A member's items were released, all at once, at one Property. The copy never
 * names them — ADR 0046 r.8 keeps other employees out of a payload — so it
 * says what is true for the reader: this work is theirs to place now.
 */
const renderAssignmentsReleased = (p: NotificationPayload): RendererCopy =>
  renderInboxBulk(
    p,
    'left unassigned',
    (items) => `${items} at this property lost their assignee. Give them a new one.`,
  )

const renderNoteAdded = (p: NotificationPayload): RendererCopy => ({
  title: `New internal note on ${p.platform === 'portal' ? 'feedback' : 'a review'}${atProperty(p)}`,
  body: `${byRole(p)} left a note on this item. Open it to read the thread.`,
  actionLabel: 'Read note',
  summary: factsAt(p, ratedNoun(p), 'internal note'),
})

const renderPortalResponsibilityNeeded = (p: NotificationPayload): RendererCopy => ({
  title: `A portal${atProperty(p)} needs a responsible manager`,
  body: 'Choose an eligible manager so portal updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: factsAt(p, 'responsible manager needed'),
})

/**
 * What is actually wrong, and the remedy. The notice used to say only that a
 * portal "may need attention", so every cause read the same and the reader had
 * to open the Portal to learn whether guests could reach it at all.
 */
const PORTAL_HEALTH_BODIES: Record<NotificationPortalHealthReason, string> = {
  publication_snapshot_unavailable:
    'Its published version is missing, so guests cannot load it. Publish it again.',
  public_address_unavailable:
    'Its web address no longer resolves, so guests cannot reach it. Check the address.',
  google_destination_unavailable:
    'Its Google review destination is gone, so the Google step is broken. Choose another.',
}

/** `unavailable` means guests cannot use it at all; `degraded` means partly. */
const PORTAL_HEALTH_TITLES: Record<NotificationPortalHealthStatus, string> = {
  unavailable: 'Guest portal is offline',
  degraded: 'Guest portal needs attention',
}

const renderPortalHealthAttention = (p: NotificationPayload): RendererCopy => {
  const status = p.portalHealthStatus
  const reason = p.portalHealthReason
  return {
    title:
      status === undefined
        ? `A guest portal${atProperty(p)} may need attention`
        : `${PORTAL_HEALTH_TITLES[status]}${atProperty(p)}`,
    body:
      reason === undefined
        ? 'Open its settings to see what changed and what to do next.'
        : PORTAL_HEALTH_BODIES[reason],
    detail: reason === undefined ? '' : PORTAL_HEALTH_BODIES[reason],
    actionLabel: 'Review portal',
    summary: factsAt(
      p,
      status === undefined ? 'Portal may need attention' : PORTAL_HEALTH_TITLES[status],
    ),
  }
}

/**
 * A site a Linktree link opens is waiting for an account admin, so guests
 * cannot see the link. The sentence names the site by its host and the Portal
 * whose Linktree the admin approves it in, and how many other Portals open it.
 */
const renderPortalLinkApprovalNeeded = (p: NotificationPayload): RendererCopy => {
  const others = p.otherPortalCount ?? 0
  const more = others === 0 ? '' : ` and ${others} other portal${others === 1 ? '' : 's'}`
  const body = sentence(
    `Guests will not see links to ${p.siteHost ?? 'this site'} until an account admin approves it.`,
    p.portalName === undefined
      ? ''
      : `Approve it in the Linktree of the ${p.portalName} portal${more}.`,
  )
  return {
    title: `A Linktree link${atProperty(p)} is waiting for approval`,
    body,
    detail: body,
    actionLabel: 'Review link',
    summary: factsAt(p, 'Linktree link waiting for approval'),
  }
}

const renderPropertyResponsibilityNeeded = (p: NotificationPayload): RendererCopy => ({
  title: `${p.propertyName ?? 'A property'} needs a responsible manager`,
  body: 'Choose an eligible manager so property-wide updates reach the right people.',
  actionLabel: 'Choose manager',
  summary: factsAt(p, 'responsible manager needed'),
})

/**
 * The Google connection belongs to the Organization. The Property its notice
 * is filed under is only a delivery anchor, so the copy never names it.
 *
 * A connection that needs reauthorization admits no sync or reply, whatever
 * the cause, so every version says updates and replies are paused. When
 * Google refused the grant itself, the copy leads with the one action that
 * restores them; when the admin whose grant backed it left, it says why.
 */
const GOOGLE_ACCESS_ENDED =
  'Google no longer accepts RepKey\u2019s access, so review updates and replies are paused.'

const googleNeedsAttention = (body: string): RendererCopy => ({
  title: 'Google connection needs attention',
  body,
  detail: body,
  actionLabel: 'Review connection',
  summary: 'Google connection needs attention',
})

const renderIntegrationReauthorizationRequired = (
  p: NotificationPayload,
): RendererCopy =>
  p.reauthorizationCause === 'provider_revoked'
    ? {
        title: 'Reconnect Google',
        body: GOOGLE_ACCESS_ENDED,
        detail: GOOGLE_ACCESS_ENDED,
        actionLabel: 'Reconnect Google',
        summary: 'Google access ended',
      }
    : googleNeedsAttention(
        p.reauthorizationCause === undefined
          ? 'Review updates and replies are paused until Google is reconnected.'
          : 'The person who connected Google is no longer an account admin here, so review updates and replies are paused. Reconnect Google to restart them.',
      )

/**
 * Somebody disconnected the Organization's Google account on purpose. The
 * copy never names them — ADR 0046 r.8 keeps other employees out of a payload
 * — so it says what stopped and where to look, and the reader's own feed is
 * the record that it happened. No Property: the connection is the
 * Organization's.
 */
const GOOGLE_DISCONNECTED =
  'Review updates and replies to Google have stopped for this organization. Reconnect it in Settings if that was not intended.'

const renderIntegrationGoogleDisconnected = (): RendererCopy => ({
  title: 'Google was disconnected',
  body: GOOGLE_DISCONNECTED,
  detail: GOOGLE_DISCONNECTED,
  actionLabel: 'Review connection',
  summary: 'Google disconnected',
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
const renderBetaFeedbackOutcome = (p: NotificationPayload): RendererCopy => {
  const [title, body] =
    p.reportOutcome === undefined
      ? ['Your report was updated', 'See where it got to.']
      : REPORT_OUTCOME_COPY[p.reportOutcome]
  return { title, body, actionLabel: 'View reports', summary: title.slice(5) }
}

const RENDERERS: Record<
  NotificationType,
  (payload: NotificationPayload, context?: NotificationRenderContext) => RendererCopy
> = {
  'account.organization_access_granted': renderOrganizationAccessGranted,
  'account.organization_role_changed': renderOrganizationRoleChanged,
  'account.organization_access_removed': renderOrganizationAccessRemoved,
  'account.organization_property_access_changed': renderOrganizationPropertyAccessChanged,
  'account.invitation_accepted': renderInvitationAccepted,
  'account.organization_purge_pending': renderOrganizationPurgePending,
  'review.created': renderReviewCreated,
  'review.updated': renderReviewUpdated,
  'review.ai_urgent_detected': renderReviewAiUrgentDetected,
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
  'inbox.unassigned': renderInboxUnassigned,
  'inbox.bulk_unassigned': renderInboxBulkUnassigned,
  'inbox.bulk_assigned': renderInboxBulkAssigned,
  'inbox.assignments_released': renderAssignmentsReleased,
  'inbox_note.added': renderNoteAdded,
  'portal.responsibility_needed': renderPortalResponsibilityNeeded,
  'portal.health_attention': renderPortalHealthAttention,
  'portal.link_approval': renderPortalLinkApprovalNeeded,
  'property.responsibility_needed': renderPropertyResponsibilityNeeded,
  'property.review_import_finished': renderReviewImportFinished,
  'integration.reauthorization_required': renderIntegrationReauthorizationRequired,
  'integration.google_disconnected': renderIntegrationGoogleDisconnected,
  'goal.completed': renderPortalGoalCompleted,
  'goal.result_revised': renderPortalGoalResultRevised,
  'goal.rating_reached': renderRatingGoalReached,
  'goal.rating_changed': renderRatingGoalChanged,
  'goal.rating_below_pace': renderRatingGoalBelowPace,
  'goal.rating_too_low': renderRatingGoalTooLow,
  'goal.rating_keep_dropped': renderRatingGoalKeepDropped,
  'beta_feedback.outcome': renderBetaFeedbackOutcome,
  'guest_voice.summary': renderGuestVoiceSummary,
}

/**
 * How a coalesced row says it repeated, with the verb for what repeated; `#`
 * is the count, the first event included. Types without one say only that it
 * happened again, which is true of all of them but those marked `null`.
 *
 * A `null` type reports where something ended up, and each event moves it on
 * rather than repeating it: a report accepted and then resolved, an import
 * that failed and then completed. Its row states only the latest outcome.
 */
const REPEATED: Partial<Record<NotificationType, string | null>> = {
  'inbox_note.added': '# notes added.',
  'inbox.escalated': 'Escalated # times.',
  'review.updated': 'Updated # times.',
  'beta_feedback.outcome': null,
  // Each Monday is a row of its own, so a repeat is a replay and says nothing.
  'guest_voice.summary': null,
  'property.review_import_finished': null,
  // A rating goal row states where the goal stands now, from its latest change.
  'goal.rating_changed': null,
  'goal.rating_below_pace': null,
  'goal.rating_too_low': null,
  'goal.rating_keep_dropped': null,
}

const repeatSentence = (type: NotificationType, repeats: number): string => {
  const copy = REPEATED[type]
  if (copy === null || repeats <= 1) return ''
  return (copy ?? 'This happened # times.').replace('#', `${repeats}`)
}

/**
 * How many times a notice's row should say it happened: its occurrences, or 1
 * for a type that reports where something ended up rather than repeating it.
 * The email body says it in words (`repeatSentence`); the in-app row as a count.
 */
export const notificationRepeatCount = (
  type: NotificationType,
  payload: NotificationPayload,
): number => (REPEATED[type] === null ? 1 : (payload.occurrences ?? 1))

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
  context?: NotificationRenderContext,
): RenderedNotification => {
  const rendered = RENDERERS[type](payload, context)
  const age = waitingAge(payload)
  return {
    ...rendered,
    detail: rendered.detail ?? '',
    body: sentence(rendered.body, repeatSentence(type, payload.occurrences ?? 1)),
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
  // Reassigned items are somebody else's now, and still in the open queue.
  'inbox.bulk_unassigned': 'open',
}

/**
 * Where an Organization notice opens when it is about one place: a member whose
 * access changed lands where their Properties are, an inviter where their
 * invitations are. The rest open the Organization profile.
 */
const ORGANIZATION_NOTICE_PATHS: Partial<Record<NotificationType, string>> = {
  'account.organization_property_access_changed': '/properties',
  'account.invitation_accepted': '/settings/members',
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
 * The payload is read only for a site waiting for approval, whose row points at
 * the site and carries the Portal to open.
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
  payload?: NotificationPayload,
): NotificationLink => {
  switch (resourceType) {
    case 'organization':
      return {
        path: (type && ORGANIZATION_NOTICE_PATHS[type]) ?? '/settings/profile',
        search: {},
      }
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
      // A Google rating goal notice opens the Property's Goals page, where the
      // rating goal leads. Any other: the resource is the monthly result the
      // notice reports; the Goals page opens the goal it belongs to.
      return type?.startsWith('goal.rating_')
        ? propertyLink(propertyId, '/goals')
        : propertyLink(propertyId, '/goals', { result: resourceId })
    case 'portal':
      return propertyLink(propertyId, `/portals/${resourceId}`, { tab: 'page' })
    case 'portal_destination':
      // A site belongs to its Property; an account admin decides it in the
      // Linktree of the Portal the notice names (`resourceId` is the site).
      return payload?.portalId === undefined
        ? propertyLink(propertyId, '/portals')
        : propertyLink(propertyId, `/portals/${payload.portalId}`, {
            tab: 'page',
            section: 'linktree',
          })
    case 'property':
      // The Monday email opens the page it summarises.
      if (type === 'guest_voice.summary') return propertyLink(propertyId, '/guests')
      // An imported history is a queue of reviews to answer, so its notice
      // opens the Property's open Inbox queue rather than the Property page.
      // The other Property notice asks for a manager, and the picker is here.
      return type === 'property.review_import_finished'
        ? {
            path: '/inbox',
            search:
              propertyId === null ? { queue: 'open' } : { queue: 'open', propertyId },
          }
        : propertyLink(propertyId, '/settings/people')
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
