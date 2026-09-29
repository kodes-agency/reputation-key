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
  NotificationGoalOutcome,
  NotificationGoalSubjectKind,
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
  detail = '',
): RendererCopy => ({
  title,
  body,
  detail,
  actionLabel: 'Review account',
  summary: title.toLowerCase(),
  whyReceived,
})

const renderOrganizationAccessGranted = (): RendererCopy =>
  accountNotice(
    'Organization access added',
    'Your account can now access this organization.',
    'You received this because your account was given access to an organization on Reputation Key.',
  )

const renderOrganizationRoleChanged = (): RendererCopy =>
  accountNotice(
    'Organization role updated',
    'Your account permissions for this organization were updated.',
    'You received this because what your account may do in an organization on Reputation Key changed.',
  )

/** A member who left is told they left, not that an administrator acted. */
/** Access removal says what to do about it, so the row shows its body. */
const informativeAccountNotice = (
  title: string,
  body: string,
  whyReceived: string,
): RendererCopy => accountNotice(title, body, whyReceived, body)

const renderOrganizationAccessRemoved = (p: NotificationPayload): RendererCopy =>
  p.leftOrganization === true
    ? informativeAccountNotice(
        'You left the organization',
        'Your account no longer has access to this organization. To come back, ask an account administrator to invite you again.',
        'You received this because you left an organization on Reputation Key.',
      )
    : informativeAccountNotice(
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
const renderOrganizationPurgePending = (p: NotificationPayload): RendererCopy => {
  const body = `The recovery window has ended. Deletion can start at any time and permanently erases its properties, portals, reviews, replies and Inbox history. Only Reputation Key support can stop it, before it starts. To stop it, answer this email or write to ${SUPPORT_EMAIL} now.`
  return {
    title: `Final notice: permanent deletion of ${p.organizationName ?? 'this organization'}`,
    body,
    detail: body,
    actionLabel: 'Open profile',
    summary: facts(p.organizationName ?? '', 'permanent deletion pending'),
    whyReceived:
      'You received this because you administer an organization that is scheduled for permanent deletion. It cannot be turned off.',
  }
}

const renderReviewCreated = (p: NotificationPayload): RendererCopy => ({
  title: `New ${'review'}${atProperty(p)}`,
  body: 'Open it to read the review and reply.',
  actionLabel: 'Read review',
  summary: factsAt(p, 'review'),
})

const renderReviewUpdated = (p: NotificationPayload): RendererCopy => ({
  title: `Review updated${atProperty(p)}`,
  body: 'The guest changed their review. Open it to check the latest details.',
  actionLabel: 'Review update',
  summary: factsAt(p, 'updated review'),
})

// Always feedback, even when the item lookup failed and left no platform.
const renderFeedbackCreated = (p: NotificationPayload): RendererCopy => ({
  title: `New guest feedback${atProperty(p)}`,
  body: 'Open it to read the feedback.',
  actionLabel: 'Read feedback',
  summary: factsAt(p, ratedFeedback(p)),
})

const renderReplyPendingApproval = (p: NotificationPayload): RendererCopy => ({
  title: `Approve a reply${atProperty(p)}`,
  body: `${byRole(p)} drafted a reply to a ${'review'}. It stays unpublished until you approve it.`,
  actionLabel: 'Review reply',
  summary: factsAt(p, 'review'),
})

const renderReplyApproved = (p: NotificationPayload): RendererCopy => ({
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

const renderReplyRejected = (p: NotificationPayload): RendererCopy => {
  const body = rejectionReasonBody(p)
  const knowsReason =
    p.hasModerationReason !== undefined || p.moderationReason !== undefined
  return {
    title: `Your reply needs changes${atProperty(p)}`,
    body,
    detail: knowsReason ? body : '',
    actionLabel: 'Edit reply',
    summary: factsAt(p, 'review'),
  }
}

const renderReplyPublished = (p: NotificationPayload): RendererCopy => ({
  title: `Your reply is live on Google${atProperty(p)}`,
  body: 'Guests can see it now. No further action needed.',
  actionLabel: 'View reply',
  summary: factsAt(p, 'review'),
})

/** The shared close of a notice that asks the reader to look, not to act. */
const SEE_WHERE = 'Open it to see where it stands.'

// `not_sent` includes an answered 429, so it says nothing was posted, as the
// Inbox's "Not published" copy does, not that nothing reached Google.
const PUBLISH_FAILURE_BODIES = {
  not_sent: 'Nothing was posted to Google, so it is safe to try again.',
  refused: 'Nothing was posted to Google. Check the Google connection, then try again.',
  unconfirmed: "RepKey won't send it twice. Open it to check.",
} as const

const RECONNECT_FIRST =
  'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry — the draft is saved.'

// A connection waiting for a fresh consent refuses every retry, and the
// author may not be the one allowed to reconnect it, so the copy says who can.
const renderReplyPublishNeedsReconnect = (p: NotificationPayload): RendererCopy => ({
  title: `Reply not published${atProperty(p)}`,
  body: RECONNECT_FIRST,
  detail: RECONNECT_FIRST,
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
const renderReplyPublishFailed = (p: NotificationPayload): RendererCopy => {
  if (p.publishFailureCause === 'google_reauthorization_required') {
    return renderReplyPublishNeedsReconnect(p)
  }
  const outcome = p.publishOutcome
  const state = outcome === 'unconfirmed' ? 'not confirmed' : 'not published'
  const cause = outcome === undefined ? '' : PUBLISH_FAILURE_BODIES[outcome]
  return {
    title: `Reply ${state}${outcome === 'unconfirmed' ? ' on Google' : ''}${atProperty(p)}`,
    body: cause === '' ? 'Open the reply to see where it stands.' : cause,
    detail: cause,
    actionLabel:
      outcome === 'not_sent' || outcome === 'refused' ? 'Retry publish' : 'View reply',
    summary: factsAt(p, 'review', state),
  }
}

/**
 * An approved reply whose publication RepKey stopped. Each cause takes a
 * different next step, so the cause decides the whole sentence: reconnect,
 * nothing to do here, write a new reply, or just look. A disconnect or a
 * policy stop only ever cancels a cycle that never went out, so only those
 * say so; a guest edit or a different live reply can stop one Google may
 * already hold, so neither claims it was not sent. The title never says
 * "your" — the same notice goes to the approvers who have to act on it.
 */
const PUBLICATION_CANCELLATION_BODIES = {
  disconnect:
    'The Google connection was disconnected before it went out. The draft is saved: reconnect Google, then approve it again.',
  policy:
    'This property can no longer publish to Google, so it was never sent. The draft is saved.',
  source_changed:
    'The guest changed their review, so RepKey stopped publishing the approved text. Open it to check what Google shows, then reply to the new review.',
  provider_truth:
    'A different reply is live on Google, so this one is not. Open it to check.',
} as const

const renderReplyPublicationCancelled = (p: NotificationPayload): RendererCopy => {
  const cause = p.publicationCancellationCause
  const why = cause === undefined ? '' : PUBLICATION_CANCELLATION_BODIES[cause]
  return {
    title: `Reply returned to draft${atProperty(p)}`,
    body: why === '' ? SEE_WHERE : why,
    detail: why,
    actionLabel: cause === 'source_changed' ? 'Open review' : 'Open reply',
    summary: factsAt(p, 'review', 'returned to draft'),
  }
}

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
 * A Property's Google review history has been imported. This one notice stands
 * in for every review it brought in — the flood PR #597 suppressed — so it
 * leads with the two numbers that decide whether anyone has work to do, and
 * sends the reader to the Property's open Inbox queue.
 *
 * A stopped import says what to do instead. `temporary` never reaches a
 * reader (RepKey retries it), but it renders honestly if one ever sees it.
 */
const IMPORT_STOPPED_COPY: Record<
  NonNullable<NotificationPayload['importFailureReason']>,
  string
> = {
  google_authorization: 'Reconnect Google, then import the history again.',
  property_source_changed:
    'This property\u2019s Google location changed. Link it again, then import the history.',
  location_too_large:
    'This location has more reviews than one import can take in. Contact RepKey support.',
  temporary: 'Nothing to do \u2014 RepKey is trying again.',
}

const importedBody = (p: NotificationPayload): string => {
  if (p.importedCount === undefined) return 'Open the inbox to see what came in.'
  const imported = `We imported ${p.importedCount} reviews`
  // An unknown count (the Inbox never settled, or a read failed) is not zero,
  // nor a sign that any are waiting: ADR 0046 drops the second number.
  if (p.unansweredCount === undefined) return `${imported}.`
  return p.unansweredCount === 0
    ? `${imported}. Nothing is waiting for a reply.`
    : `${imported}; ${p.unansweredCount} still need a reply.`
}

const renderReviewImportFinished = (p: NotificationPayload): RendererCopy =>
  p.importOutcome === 'failed'
    ? {
        title: `Review history import stopped${atProperty(p)}`,
        body:
          p.importFailureReason === undefined
            ? 'Open the property to start the import again.'
            : IMPORT_STOPPED_COPY[p.importFailureReason],
        detail:
          p.importFailureReason === undefined
            ? ''
            : IMPORT_STOPPED_COPY[p.importFailureReason],
        actionLabel: 'Open inbox',
        summary: factsAt(p, 'review import stopped'),
      }
    : {
        title: `Review history imported${atProperty(p)}`,
        body: importedBody(p),
        detail: p.importedCount === undefined ? '' : importedBody(p),
        actionLabel: 'Open inbox',
        summary: factsAt(p, 'review history imported'),
      }

/** "October goal met: Lobby QR scans at Riverside Hotel". */
const goalTitle = (lead: string, p: NotificationPayload): string =>
  `${lead}${p.goalName === undefined ? '' : `: ${p.goalName}`}${atProperty(p)}`

/** One formatter for the month name; the key is already Property-local. */
let monthFormat: Intl.DateTimeFormat | undefined

/**
 * "October" from the `YYYY-MM` key the Property's own calendar closed the
 * month on. Formatted in UTC because the key is a calendar month, not an
 * instant: reading it on any other clock could name the month before it.
 */
const goalMonth = (p: NotificationPayload): string => {
  if (p.goalMonth === undefined) return ''
  const [year, month] = p.goalMonth.split('-').map(Number)
  // The allowlist admits only `YYYY-MM`, but a template must never throw on a
  // payload that reached it unparsed: `Intl.format(NaN)` is a RangeError, and
  // this renders in the bell's own paint.
  if (!Number.isInteger(year) || !Number.isInteger(month)) return ''
  monthFormat ??= new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
  return monthFormat.format(Date.UTC(year!, month! - 1, 1))
}

/** The glossary's words, so a reader can tell ten sibling results apart. */
const GOAL_SUBJECTS: Record<NotificationGoalSubjectKind, string> = {
  property: 'Property',
  portal_group: 'Portal Group',
  portal: 'Portal',
}

/** "This Portal goal" / "This goal" when the subject did not resolve. */
const thisGoal = (p: NotificationPayload): string =>
  p.goalSubjectKind === undefined
    ? 'This goal'
    : `This ${GOAL_SUBJECTS[p.goalSubjectKind]} goal`

/** "October goal met", or "Goal met" when the month did not resolve. */
const goalOutcomeTitle = (p: NotificationPayload, outcome: string): string => {
  const month = goalMonth(p)
  return month === '' ? `Goal ${outcome}` : `${month} goal ${outcome}`
}

const renderGoalCompleted = (p: NotificationPayload): RendererCopy => ({
  title: goalTitle(goalOutcomeTitle(p, 'met'), p),
  body: sentence(`${thisGoal(p)} hit its target.`, 'Open the goal to see the numbers.'),
  // Which of ten sibling results it is: the title says only "goal".
  detail: p.goalSubjectKind === undefined ? '' : `${thisGoal(p)} hit its target.`,
  actionLabel: 'View progress',
  summary: factsAt(
    p,
    p.goalName ?? 'goal met',
    p.goalSubjectKind === undefined ? '' : GOAL_SUBJECTS[p.goalSubjectKind],
  ),
})

/**
 * Which way the month went. A correction that leaves the result unusable is
 * not a miss, so it says the result is gone rather than that the goal failed.
 */
const GOAL_OUTCOME_TITLES: Record<NotificationGoalOutcome, string> = {
  met: 'met',
  not_met: 'no longer met',
  unavailable: 'result unavailable',
}

const GOAL_OUTCOME_CLAUSES: Record<NotificationGoalOutcome, string> = {
  met: 'now meets its target',
  not_met: 'no longer meets its target',
  unavailable: 'has no usable result for the month',
}

const renderGoalResultRevised = (p: NotificationPayload): RendererCopy => {
  const outcome = p.goalOutcome
  return {
    title: goalTitle(
      outcome === undefined
        ? 'Goal result updated'
        : goalOutcomeTitle(p, GOAL_OUTCOME_TITLES[outcome]),
      p,
    ),
    body: sentence(
      outcome === undefined
        ? 'A monthly result changed.'
        : `${thisGoal(p)} ${GOAL_OUTCOME_CLAUSES[outcome]}.`,
      'Open the goal to see the current metrics.',
    ),
    detail:
      outcome === undefined || p.goalSubjectKind === undefined
        ? ''
        : `${thisGoal(p)} ${GOAL_OUTCOME_CLAUSES[outcome]}.`,
    actionLabel: 'View result',
    summary: factsAt(
      p,
      p.goalName ?? 'goal result updated',
      p.goalSubjectKind === undefined ? '' : GOAL_SUBJECTS[p.goalSubjectKind],
    ),
  }
}

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
  'inbox.unassigned': renderInboxUnassigned,
  'inbox.bulk_unassigned': renderInboxBulkUnassigned,
  'inbox.bulk_assigned': renderInboxBulkAssigned,
  'inbox.assignments_released': renderAssignmentsReleased,
  'inbox_note.added': renderNoteAdded,
  'portal.responsibility_needed': renderPortalResponsibilityNeeded,
  'portal.health_attention': renderPortalHealthAttention,
  'property.responsibility_needed': renderPropertyResponsibilityNeeded,
  'property.review_import_finished': renderReviewImportFinished,
  'integration.reauthorization_required': renderIntegrationReauthorizationRequired,
  'integration.google_disconnected': renderIntegrationGoogleDisconnected,
  'goal.completed': renderGoalCompleted,
  'goal.result_revised': renderGoalResultRevised,
  'beta_feedback.outcome': renderBetaFeedbackOutcome,
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
  'property.review_import_finished': null,
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
