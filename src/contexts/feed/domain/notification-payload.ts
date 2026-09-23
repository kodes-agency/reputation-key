// Feed notification surface — content-free render metadata (ADR 0046 r.8).
//
// A notification's user-facing copy is rendered from `type` + this payload at
// READ time (see `notification-templates.ts`), not frozen into a string at
// enqueue time. That is what lets a notification say
//
//   "New guest feedback · Riverside Hotel · waited 3h"
//
// instead of "New review received", while still obeying the source-content
// boundary.
//
// THE BOUNDARY (ADR 0046 r.8, ADR 0031, BQC-1.2). Payload carries
// "property/resource/status metadata" ONLY:
//
//   ALLOWED   tenant-authored organization, property and goal names, the locally collected
//             1-5 guest rating, actor ROLE, counts, when a wait began, platform
//             enum, whether an approver gave a reason, how a publication
//             ended (closed enum), and an internal moderation reason
//             (staff-authored; historical rows only).
//   FORBIDDEN Google/provider review ratings and content, reply text,
//             guest/reviewer name, media URLs, sentiment or any derived score,
//             and any other employee's NAME or email.
//
// `parseNotificationPayload` is the only way a payload enters the domain, and
// it drops every unrecognised key. A new field must be added here AND to
// PROTECTED_FIELD_REGISTRY (`notifications.payload`) — the governance test
// fails otherwise.

/** Star rating collected locally through a RepKey guest Portal. */
export type NotificationGuestRating = 1 | 2 | 3 | 4 | 5

/**
 * Actor role — we surface WHO acted by role, never by name, because ADR 0046
 * r.8 excludes other employees' data.
 */
export type NotificationActorRole = 'account_admin' | 'property_manager' | 'staff'

export type NotificationPlatform = 'google' | 'portal'

export type NotificationPayload = Readonly<{
  /**
   * Tenant-authored property name, minted on every Property-scoped notice
   * except the Google connection's, whose Property is only a delivery anchor.
   */
  propertyName?: string
  /** Tenant-authored organization name (Organization-scoped notices). */
  organizationName?: string
  /** Locally collected 1-5 guest rating; valid only with platform=portal. */
  guestRating?: NotificationGuestRating
  /** Review source platform. */
  platform?: NotificationPlatform
  /**
   * Historical rows only: an age frozen when the row was written and measured
   * from the item's first arrival. Copy never renders it; see `waitingSince`.
   */
  waitingHours?: number
  /**
   * When the current wait began (ISO instant): the start of the current
   * cycle's Response Target, stamped only on notices about something still
   * waiting. A repeat event that measured no wait drops it.
   */
  waitingSince?: string
  /**
   * How long that wait had lasted, in whole hours, when the row's latest
   * event was raised. The read projects it from `waitingSince` and the row's
   * time; it is never stored and never parsed, so an age cannot grow after
   * the fact or outlive the wait.
   */
  waitedHours?: number
  /** Role of the person whose action produced this notification. */
  actorRole?: NotificationActorRole
  /**
   * Staff-authored moderation reason (reply.rejected only). Only rows written
   * before the reason left the durable fact carry it (ADR 0030).
   */
  moderationReason?: string
  /**
   * Whether the approver gave a reason (reply.rejected only). The reason
   * itself stays on the reply. Absent when the fact did not say.
   */
  hasModerationReason?: boolean
  /**
   * How a publication ended without a confirmed live reply
   * (reply.publish_failed only). Absent on rows recorded before facts said.
   */
  publishOutcome?: NotificationPublishOutcome
  /** Tenant-authored goal name (goal.completed). */
  goalName?: string
  /** Repeat-event count when a row has coalesced. */
  occurrences?: number
  /** Number of Inbox items represented by one grouped assignment fact. */
  itemCount?: number
  /**
   * Where the recipient's own beta report ended up (`beta_feedback.outcome`).
   * A closed enum, never the report's text — that stays in monitoring.
   */
  reportOutcome?: NotificationReportOutcome
  /**
   * Why a Google connection needs a fresh consent
   * (`integration.reauthorization_required`). The event's closed cause.
   */
  reauthorizationCause?: NotificationReauthorizationCause
  /** Why a reply could not be published when a retry alone cannot fix it. */
  publishFailureCause?: NotificationPublishFailureCause
  /**
   * Why an approved reply was returned to draft before it reached Google
   * (`reply.publication_cancelled`). The event's own closed cause; it decides
   * the whole sentence, because each cause asks for a different next step.
   */
  publicationCancellationCause?: NotificationPublicationCancellationCause
  /**
   * Why a Handling Cycle was reopened (`inbox.reopened` only). The event's
   * own closed enum: a manager's governed reason, or what Google did to the
   * published reply. Never the free-text explanation beside it, which stays
   * in Inbox.
   */
  reopenReason?: NotificationReopenReason
  /**
   * What is wrong with a Portal (`portal.health_attention` only): the derived
   * health status and the closed reason that produced it. Both, because the
   * status still shapes the title when a later reason has no sentence yet.
   */
  portalHealthStatus?: NotificationPortalHealthStatus
  portalHealthReason?: NotificationPortalHealthReason
  /**
   * The Response Target's target time (ISO instant), on the two reminder
   * notices only. An instant, never a rendered label: the copy formats it in
   * the READER's timezone, and two people on one item may not share one.
   */
  targetDueAt?: string
  /**
   * Which month's result a Goal notice reports, as `YYYY-MM` in the
   * PROPERTY's own timezone, which is the calendar the month was closed on. A
   * key, not a label: the template writes the month name, as it writes every
   * other word.
   */
  goalMonth?: string
  /** Whether the Goal is assigned to the Property, a Portal Group or a Portal. */
  goalSubjectKind?: NotificationGoalSubjectKind
  /** Which way the month's result stands now. */
  goalOutcome?: NotificationGoalOutcome
}>

export type NotificationPublicationCancellationCause =
  'disconnect' | 'policy' | 'source_changed' | 'provider_truth'

export type NotificationGoalSubjectKind = 'property' | 'portal_group' | 'portal'

/**
 * The direction of a monthly result: it meets its target, it does not, or the
 * month has no usable result at all (insufficient data, unavailable,
 * quarantined). Never the numbers.
 */
export type NotificationGoalOutcome = 'met' | 'not_met' | 'unavailable'

/** A Portal health state that asks for attention; `healthy` never notifies. */
export type NotificationPortalHealthStatus = 'degraded' | 'unavailable'

/**
 * The Portal health causes that raise a notice: the automatic states with a
 * concrete recovery action. Intentional publication states and recovery are
 * receipt-only and never reach a payload.
 */
export type NotificationPortalHealthReason =
  | 'publication_snapshot_unavailable'
  | 'public_address_unavailable'
  | 'google_destination_unavailable'

/**
 * The governed causes `inbox.handling_cycle.reopened` carries: five a manager
 * chooses and two an exact provider observation raises.
 */
export type NotificationReopenReason =
  | 'guest_follow_up_still_needed'
  | 'internal_follow_up_still_needed'
  | 'new_information'
  | 'correcting_handling_status'
  | 'other'
  | 'provider_reply_deleted'
  | 'provider_reply_diverged'

export type NotificationReportOutcome = 'accepted' | 'declined' | 'resolved'

export type NotificationReauthorizationCause =
  'provider_revoked' | 'member_removed' | 'account_admin_role_lost'

export type NotificationPublishFailureCause = 'google_reauthorization_required'

export type NotificationPublishOutcome = 'not_sent' | 'refused' | 'unconfirmed'

const ACTOR_ROLES: Record<string, true> = {
  account_admin: true,
  property_manager: true,
  staff: true,
}

const PLATFORMS: Record<string, true> = { google: true, portal: true }

const REPORT_OUTCOMES: Record<string, true> = {
  accepted: true,
  declined: true,
  resolved: true,
}

const REAUTHORIZATION_CAUSES: Record<string, true> = {
  provider_revoked: true,
  member_removed: true,
  account_admin_role_lost: true,
}

const PUBLISH_FAILURE_CAUSES: Record<string, true> = {
  google_reauthorization_required: true,
}

const PUBLICATION_CANCELLATION_CAUSES: Record<string, true> = {
  disconnect: true,
  policy: true,
  source_changed: true,
  provider_truth: true,
}

const PORTAL_HEALTH_STATUSES: Record<string, true> = {
  degraded: true,
  unavailable: true,
}

const PORTAL_HEALTH_REASONS: Record<string, true> = {
  publication_snapshot_unavailable: true,
  public_address_unavailable: true,
  google_destination_unavailable: true,
}

const GOAL_SUBJECT_KINDS: Record<string, true> = {
  property: true,
  portal_group: true,
  portal: true,
}

const GOAL_OUTCOMES: Record<string, true> = {
  met: true,
  not_met: true,
  unavailable: true,
}

const REOPEN_REASONS: Record<string, true> = {
  guest_follow_up_still_needed: true,
  internal_follow_up_still_needed: true,
  new_information: true,
  correcting_handling_status: true,
  other: true,
  provider_reply_deleted: true,
  provider_reply_diverged: true,
}

const PUBLISH_OUTCOMES: Record<string, true> = {
  not_sent: true,
  refused: true,
  unconfirmed: true,
}

/** Longest free-ish text we accept. Names, not prose. */
const MAX_NAME_LENGTH = 120
/** Staff-authored moderation reasons are capped before durable delivery. */
const MAX_REASON_LENGTH = 500

/** Trimmed non-empty string under `max`, else undefined. Never throws. */
const takeText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

const takeGuestRating = (value: unknown): NotificationGuestRating | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= 1 && value <= 5 ? (value as NotificationGuestRating) : undefined
}

/** Non-negative integer count. Fractional/negative input is dropped, not coerced. */
const takeCount = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
  return value
}

const takeMember = <T extends string>(
  value: unknown,
  allowed: Record<string, true>,
): T | undefined =>
  typeof value === 'string' && allowed[value] === true ? (value as T) : undefined

/** A valid instant, normalised to ISO-8601 UTC. Never throws. */
const takeInstant = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

/** `YYYY-MM`, a real calendar month. Anything else is dropped. */
const takeMonthKey = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : undefined

/** A real boolean only; "true", 1 and null are not flags. */
const takeFlag = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

/** Shape of the untrusted input: the payload keys, each still `unknown`. */
type RawPayload = Partial<Record<keyof NotificationPayload, unknown>>

/**
 * Build a payload from untrusted input (a JSONB column, a BullMQ job body).
 * Unknown keys and ill-typed values are DROPPED rather than rejected: a
 * malformed payload must degrade the copy, never lose the notification.
 */
export const parseNotificationPayload = (input: unknown): NotificationPayload => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const raw = input as RawPayload

  const parsed: Record<string, unknown> = {}
  const set = (key: keyof NotificationPayload, value: unknown): void => {
    if (value !== undefined) parsed[key] = value
  }

  set('propertyName', takeText(raw.propertyName, MAX_NAME_LENGTH))
  set('organizationName', takeText(raw.organizationName, MAX_NAME_LENGTH))
  const platform = takeMember<NotificationPlatform>(raw.platform, PLATFORMS)
  set('platform', platform)
  if (platform === 'portal') {
    set('guestRating', takeGuestRating(raw.guestRating))
  }
  set('waitingHours', takeCount(raw.waitingHours))
  set('waitingSince', takeInstant(raw.waitingSince))
  set('actorRole', takeMember(raw.actorRole, ACTOR_ROLES))
  set('moderationReason', takeText(raw.moderationReason, MAX_REASON_LENGTH))
  set('hasModerationReason', takeFlag(raw.hasModerationReason))
  set(
    'publishOutcome',
    takeMember<NotificationPublishOutcome>(raw.publishOutcome, PUBLISH_OUTCOMES),
  )
  set('goalName', takeText(raw.goalName, MAX_NAME_LENGTH))
  set('occurrences', takeCount(raw.occurrences))
  set('itemCount', takeCount(raw.itemCount))
  set(
    'reportOutcome',
    takeMember<NotificationReportOutcome>(raw.reportOutcome, REPORT_OUTCOMES),
  )
  set(
    'reauthorizationCause',
    takeMember<NotificationReauthorizationCause>(
      raw.reauthorizationCause,
      REAUTHORIZATION_CAUSES,
    ),
  )
  set(
    'publishFailureCause',
    takeMember<NotificationPublishFailureCause>(
      raw.publishFailureCause,
      PUBLISH_FAILURE_CAUSES,
    ),
  )
  set(
    'publicationCancellationCause',
    takeMember<NotificationPublicationCancellationCause>(
      raw.publicationCancellationCause,
      PUBLICATION_CANCELLATION_CAUSES,
    ),
  )
  set(
    'reopenReason',
    takeMember<NotificationReopenReason>(raw.reopenReason, REOPEN_REASONS),
  )
  set(
    'portalHealthStatus',
    takeMember<NotificationPortalHealthStatus>(
      raw.portalHealthStatus,
      PORTAL_HEALTH_STATUSES,
    ),
  )
  set(
    'portalHealthReason',
    takeMember<NotificationPortalHealthReason>(
      raw.portalHealthReason,
      PORTAL_HEALTH_REASONS,
    ),
  )
  set('targetDueAt', takeInstant(raw.targetDueAt))
  set('goalMonth', takeMonthKey(raw.goalMonth))
  set(
    'goalSubjectKind',
    takeMember<NotificationGoalSubjectKind>(raw.goalSubjectKind, GOAL_SUBJECT_KINDS),
  )
  set('goalOutcome', takeMember<NotificationGoalOutcome>(raw.goalOutcome, GOAL_OUTCOMES))

  return parsed as NotificationPayload
}

/** True when the payload carries nothing worth persisting. */
export const isEmptyNotificationPayload = (payload: NotificationPayload): boolean =>
  Object.keys(payload).length === 0
