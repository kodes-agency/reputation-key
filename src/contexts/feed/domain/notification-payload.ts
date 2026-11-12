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
//   ALLOWED   tenant-authored organization, property and goal names, the name of
//             the Portal or Portal Group a goal is on, the locally collected
//             1-5 guest rating, actor ROLE, counts, when a wait began, platform
//             enum, whether an approver gave a reason, how a publication
//             ended (closed enum), an internal moderation reason
//             (staff-authored; historical rows only), and whether the notice
//             is a Low ratings one for its reader (`lowRating`: the outcome of
//             the reader's own threshold, never the stars), the one marker
//             a Goal notice may carry about its month (`goalMarker`: a closed
//             enum, never a date, a target or a person), a portal goal's
//             measure (closed enum) and, for a count measure, its month's count
//             and target as whole numbers (ADR 0046, amended 2026-10-17), and
//             the Property-level
//             figures a Google rating goal notice states (`rating*`: the tenths
//             Google shows for the Property now and before and the goal's
//             target, the goal's mode and pace, and the recent pace of new
//             reviews; the only rating figures are the tenths Google itself
//             shows and the target, none RepKey works out from review
//             ratings; ADR 0046, amended 2026-10-14), and, for a site waiting for
//             an account admin, the site's HOST (never its address), the name
//             and id of the Portal to decide it on, and how many others open
//             it (ADR 0046, amended 2026-10-26), and, for a Guest voice
//             summary, the page's three lines as fixed facts: one of the twelve
//             topics, counts of reviews, the window, and the stars a problem
//             may be worth on the Property's own average (`guestVoice*`, below;
//             ADR 0046, amended 2026-10-30). Never the issue's name, a cause, a quote or a review.
//   FORBIDDEN a Google/provider review's rating and any review content, reply
//             text, guest/reviewer name, media URLs, sentiment or any other
//             derived score (including an average RepKey works out from
//             review ratings), and any other employee's NAME or email.
//
// `parseNotificationPayload` is the only way a payload enters the domain, and
// it drops every unrecognised key. A new field is added here, to the type and
// to the parser, and to the ALLOWED list above; the "parses every field" test
// fails when the parser misses one. PROTECTED_FIELD_REGISTRY governs the
// `notifications.payload` COLUMN as a whole (protected-field-registry.ts), so
// it has no per-key entry to add.

/** Star rating collected locally through a RepKey guest Portal. */
export type NotificationGuestRating = 1 | 2 | 3 | 4 | 5

/**
 * Actor role — we surface WHO acted by role, never by name, because ADR 0046
 * r.8 excludes other employees' data.
 */
const ACTOR_ROLES = ['account_admin', 'property_manager', 'staff'] as const
export type NotificationActorRole = (typeof ACTOR_ROLES)[number]

/** A role a member can hold and a notice names; `staff` is an actor role only. */
const MEMBER_ROLES = ['account_admin', 'property_manager'] as const
export type NotificationMemberRole = (typeof MEMBER_ROLES)[number]

const PLATFORMS = ['google', 'portal'] as const
export type NotificationPlatform = (typeof PLATFORMS)[number]

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
   * The member left the Organization themselves
   * (account.organization_access_removed only). Absent means an administrator
   * removed them, or the row predates the fact saying so.
   */
  leftOrganization?: boolean
  /**
   * The role the member now holds (account.organization_role_changed only):
   * a closed enum, so the notice can say "You are now a Property Manager"
   * without a person's name. Absent for a role the copy has no phrase for.
   */
  memberRole?: NotificationMemberRole
  /**
   * This notice reached its reader because the review or feedback is at or
   * below their own Low-ratings threshold (ADR 0046, amended 2026-09-30).
   * Set only when true, and only on a rated type. The routing outcome, never
   * the rating: a Google review's stars stay in Review's cache (ADR 0031).
   */
  lowRating?: true
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
  /**
   * The one thing a reader of "goal met" should know about the month's target:
   * it was not in place for the whole month. Absent for a goal that was.
   */
  goalMarker?: NotificationGoalMarker
  /** What a portal goal counts or averages. */
  goalMeasure?: NotificationGoalMeasure
  /**
   * A count goal's month as it stands now, and the target it was judged
   * against: whole numbers, kept only with a count measure. An average states
   * neither; its notice sends the reader to the goal.
   */
  goalCount?: number
  goalTargetCount?: number
  /**
   * Tenant-authored name of the Portal or Portal Group a goal is on. A
   * Property goal carries none: its notice names the Property.
   */
  goalSubjectName?: string
  /**
   * How a Property's first Google review import ended
   * (`property.review_import_finished`). Absent degrades to the neutral copy.
   */
  importOutcome?: NotificationImportOutcome
  /** Reviews that import took in. A count, never anything they contain. */
  importedCount?: number
  /** How many of the Property's Inbox items were still open when it finished. */
  unansweredCount?: number
  /** The import's closed failure reason; absent unless it failed. */
  importFailureReason?: NotificationImportFailureReason
  /**
   * The Google rating goal notices (`goal.rating_*`): Property-level figures
   * only, never a review's rating. The tenth Google shows now (45 = 4.5), and
   * before the change for `goal.rating_changed`.
   */
  ratingShownTenths?: number
  ratingPreviousTenths?: number
  /** The goal's target tenth, or the tenth a keep goal keeps. */
  ratingTargetTenths?: number
  ratingGoalMode?: NotificationRatingGoalMode
  /** The goal's chosen pace, whole new Google reviews a week (the legacy mirror). */
  ratingPacePerWeek?: number
  /** The goal's chosen pace in tenths of a review a week (105 is 1.5 a day). */
  ratingPaceTenthsPerWeek?: number
  /** New Google reviews a week in the pace window, in tenths, rounded down. */
  ratingRecentPaceTenths?: number
  ratingPaceWindow?: NotificationRatingPaceWindow
  /**
   * A site waiting for an account admin (`portal.link_approval`): its
   * host, never the address, and the Portal whose Linktree it is decided on
   * (name for the sentence, id only for the deep link), with how many other
   * Portals' links open it.
   */
  siteHost?: string
  portalName?: string
  portalId?: string
  otherPortalCount?: number
}> &
  GuestVoiceSummaryPayloadFields

const RATING_GOAL_MODES = ['climb', 'keep'] as const
export type NotificationRatingGoalMode = (typeof RATING_GOAL_MODES)[number]

/** Over which days a below-pace notice counted the reviews. */
const RATING_PACE_WINDOWS = ['last_4_weeks', 'since_set', 'since_pace_change'] as const
export type NotificationRatingPaceWindow = (typeof RATING_PACE_WINDOWS)[number]

const IMPORT_OUTCOMES = ['completed', 'failed'] as const
export type NotificationImportOutcome = (typeof IMPORT_OUTCOMES)[number]

const IMPORT_FAILURE_REASONS = [
  'google_authorization',
  'property_source_changed',
  'location_too_large',
  'temporary',
] as const
export type NotificationImportFailureReason = (typeof IMPORT_FAILURE_REASONS)[number]

const PUBLICATION_CANCELLATION_CAUSES = [
  'disconnect',
  'policy',
  'source_changed',
  'provider_truth',
  'ai_draft_withdrawn',
] as const
export type NotificationPublicationCancellationCause =
  (typeof PUBLICATION_CANCELLATION_CAUSES)[number]

const GOAL_SUBJECT_KINDS = ['property', 'portal_group', 'portal'] as const
export type NotificationGoalSubjectKind = (typeof GOAL_SUBJECT_KINDS)[number]

/**
 * The direction of a monthly result: it meets its target, it does not, or the
 * month has no usable result at all (insufficient data, unavailable,
 * quarantined). Never the numbers.
 */
const GOAL_OUTCOMES = ['met', 'not_met', 'unavailable'] as const
export type NotificationGoalOutcome = (typeof GOAL_OUTCOMES)[number]

/**
 * How a month's target came about when it did not stand for the whole month:
 * the goal was set after the month began, or its target was changed while the
 * month ran. One marker per notice; never when, by whom or to what.
 */
const GOAL_MARKERS = ['set_in_month', 'target_changed'] as const
export type NotificationGoalMarker = (typeof GOAL_MARKERS)[number]

/** The three measures a portal goal is set on. */
const GOAL_MEASURES = [
  'qualified_scans',
  'portal_rating_count',
  'portal_rating_average',
] as const
export type NotificationGoalMeasure = (typeof GOAL_MEASURES)[number]

/** A Portal health state that asks for attention; `healthy` never notifies. */
const PORTAL_HEALTH_STATUSES = ['degraded', 'unavailable'] as const
export type NotificationPortalHealthStatus = (typeof PORTAL_HEALTH_STATUSES)[number]

/**
 * The Portal health causes that raise a notice: the automatic states with a
 * concrete recovery action. Intentional publication states and recovery are
 * receipt-only and never reach a payload.
 */
const PORTAL_HEALTH_REASONS = [
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'google_destination_unavailable',
] as const
export type NotificationPortalHealthReason = (typeof PORTAL_HEALTH_REASONS)[number]

/**
 * The governed causes `inbox.handling_cycle.reopened` carries: five a manager
 * chooses, two an exact provider observation raises, and the guest editing a
 * Review that had been answered.
 */
const REOPEN_REASONS = [
  'guest_follow_up_still_needed',
  'internal_follow_up_still_needed',
  'new_information',
  'correcting_handling_status',
  'other',
  'provider_reply_deleted',
  'provider_reply_diverged',
  'material_revision_changed',
] as const
export type NotificationReopenReason = (typeof REOPEN_REASONS)[number]

const REPORT_OUTCOMES = ['accepted', 'declined', 'resolved'] as const
export type NotificationReportOutcome = (typeof REPORT_OUTCOMES)[number]

const REAUTHORIZATION_CAUSES = [
  'provider_revoked',
  'member_removed',
  'account_admin_role_lost',
] as const
export type NotificationReauthorizationCause = (typeof REAUTHORIZATION_CAUSES)[number]

const PUBLISH_FAILURE_CAUSES = ['google_reauthorization_required'] as const
export type NotificationPublishFailureCause = (typeof PUBLISH_FAILURE_CAUSES)[number]

const PUBLISH_OUTCOMES = ['not_sent', 'refused', 'unconfirmed'] as const
export type NotificationPublishOutcome = (typeof PUBLISH_OUTCOMES)[number]

/** A goal's count or target: a whole number up to a billion. */
const MAX_GOAL_COUNT = 1_000_000_000

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

/** One of the listed values, else undefined. */
const takeMember = <const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined

/** A valid instant, normalised to ISO-8601 UTC. Never throws. */
const takeInstant = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

/** `YYYY-MM`, a real calendar month. Anything else is dropped. */
const takeMonthKey = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : undefined

/** An integer from `min` to `max`; anything else is dropped. */
const takeIntegerIn = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined

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
  const platform = takeMember(raw.platform, PLATFORMS)
  set('platform', platform)
  if (platform === 'portal') {
    set('guestRating', takeGuestRating(raw.guestRating))
  }
  set('waitingHours', takeCount(raw.waitingHours))
  set('waitingSince', takeInstant(raw.waitingSince))
  set('actorRole', takeMember(raw.actorRole, ACTOR_ROLES))
  set('moderationReason', takeText(raw.moderationReason, MAX_REASON_LENGTH))
  set('hasModerationReason', takeFlag(raw.hasModerationReason))
  set('leftOrganization', takeFlag(raw.leftOrganization))
  set('memberRole', takeMember(raw.memberRole, MEMBER_ROLES))
  set('lowRating', raw.lowRating === true ? true : undefined)
  set('publishOutcome', takeMember(raw.publishOutcome, PUBLISH_OUTCOMES))
  set('goalName', takeText(raw.goalName, MAX_NAME_LENGTH))
  set('occurrences', takeCount(raw.occurrences))
  set('itemCount', takeCount(raw.itemCount))
  set('reportOutcome', takeMember(raw.reportOutcome, REPORT_OUTCOMES))
  set(
    'reauthorizationCause',
    takeMember(raw.reauthorizationCause, REAUTHORIZATION_CAUSES),
  )
  set('publishFailureCause', takeMember(raw.publishFailureCause, PUBLISH_FAILURE_CAUSES))
  set(
    'publicationCancellationCause',
    takeMember(raw.publicationCancellationCause, PUBLICATION_CANCELLATION_CAUSES),
  )
  set('reopenReason', takeMember(raw.reopenReason, REOPEN_REASONS))
  set('portalHealthStatus', takeMember(raw.portalHealthStatus, PORTAL_HEALTH_STATUSES))
  set('portalHealthReason', takeMember(raw.portalHealthReason, PORTAL_HEALTH_REASONS))
  set('targetDueAt', takeInstant(raw.targetDueAt))
  set('goalMonth', takeMonthKey(raw.goalMonth))
  set('goalSubjectKind', takeMember(raw.goalSubjectKind, GOAL_SUBJECT_KINDS))
  set('goalOutcome', takeMember(raw.goalOutcome, GOAL_OUTCOMES))
  set('goalMarker', takeMember(raw.goalMarker, GOAL_MARKERS))
  setPortalGoalFigures(raw, set)
  const importOutcome = takeMember(raw.importOutcome, IMPORT_OUTCOMES)
  set('importOutcome', importOutcome)
  set('importedCount', takeCount(raw.importedCount))
  set('unansweredCount', takeCount(raw.unansweredCount))
  // A reason belongs to a failure. Keeping one on a completed import would
  // render "the import stopped" copy over a successful one.
  if (importOutcome === 'failed') {
    set(
      'importFailureReason',
      takeMember(raw.importFailureReason, IMPORT_FAILURE_REASONS),
    )
  }

  setRatingGoalFigures(raw, set)
  setWaitingSiteFacts(raw, set)

  // The Guest voice summary's kind, window and at most three lines (ADR 0046 r.8).
  return {
    ...parsed,
    ...parseGuestVoiceSummaryFields(raw as Readonly<Record<string, unknown>>),
  } as NotificationPayload
}

/**
 * A portal goal notice's measure, figures and subject name. Counts belong to a
 * count measure only: without one, "4" could be an average.
 */
function setPortalGoalFigures(
  raw: RawPayload,
  set: (key: keyof NotificationPayload, value: unknown) => void,
): void {
  const measure = takeMember(raw.goalMeasure, GOAL_MEASURES)
  set('goalMeasure', measure)
  if (measure === 'qualified_scans' || measure === 'portal_rating_count') {
    set('goalCount', takeIntegerIn(raw.goalCount, 0, MAX_GOAL_COUNT))
    set('goalTargetCount', takeIntegerIn(raw.goalTargetCount, 0, MAX_GOAL_COUNT))
  }
  set('goalSubjectName', takeText(raw.goalSubjectName, MAX_NAME_LENGTH))
}

/** The longest host name there is (RFC 1035). */
const MAX_HOST_LENGTH = 253

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A uuid exactly as written, never a longer string cut down to one. */
const takeUuid = (value: unknown): string | undefined =>
  typeof value === 'string' && UUID_SHAPE.test(value) ? value : undefined

/** A site waiting for approval: its host, and the Portal it is decided on. */
function setWaitingSiteFacts(
  raw: RawPayload,
  set: (key: keyof NotificationPayload, value: unknown) => void,
): void {
  set('siteHost', takeText(raw.siteHost, MAX_HOST_LENGTH))
  set('portalName', takeText(raw.portalName, MAX_NAME_LENGTH))
  set('portalId', takeUuid(raw.portalId))
  set('otherPortalCount', takeIntegerIn(raw.otherPortalCount, 0, 1_000))
}

/** The Google rating goal notices' figures, each in its own range. */
function setRatingGoalFigures(
  raw: RawPayload,
  set: (key: keyof NotificationPayload, value: unknown) => void,
): void {
  set('ratingShownTenths', takeIntegerIn(raw.ratingShownTenths, 0, 50))
  set('ratingPreviousTenths', takeIntegerIn(raw.ratingPreviousTenths, 0, 50))
  set('ratingTargetTenths', takeIntegerIn(raw.ratingTargetTenths, 10, 50))
  set('ratingGoalMode', takeMember(raw.ratingGoalMode, RATING_GOAL_MODES))
  set('ratingPacePerWeek', takeIntegerIn(raw.ratingPacePerWeek, 1, 350))
  set('ratingPaceTenthsPerWeek', takeIntegerIn(raw.ratingPaceTenthsPerWeek, 10, 3500))
  set('ratingRecentPaceTenths', takeIntegerIn(raw.ratingRecentPaceTenths, 0, 100_000))
  set('ratingPaceWindow', takeMember(raw.ratingPaceWindow, RATING_PACE_WINDOWS))
}

/** True when the payload carries nothing worth persisting. */
export const isEmptyNotificationPayload = (payload: NotificationPayload): boolean =>
  Object.keys(payload).length === 0

// ── Guest voice summary ─────────────────────────────────────────────
// The Monday email and the monthly roundup state the page's three lines as fixed topics,
// counts and a window: nothing the guests wrote and nothing boiled down from it (not the
// issue's name, which is their words in short). The parser drops what it does not
// recognise, line by line: a malformed line shortens the email, it never loses it.

const GUEST_VOICE_WINDOWS = ['30d', '90d', '180d', '365d'] as const
export type NotificationGuestVoiceWindow = (typeof GUEST_VOICE_WINDOWS)[number]

/**
 * The twelve topics of review analysis v3, as the notice states them. Restated here, as
 * Feed's domain reads no module outside `shared/domain` (the same reason the rating goal
 * notices restate one of Reporting's thresholds); a test pins this list and the labels in
 * ./notification-templates-guest-voice.ts to `review-topic-taxonomy.ts`.
 */
export const NOTIFICATION_GUEST_VOICE_TOPICS = [
  'staff_service',
  'speed_waiting',
  'booking_arrival',
  'main_service',
  'food_drink',
  'cleanliness',
  'facilities_equipment',
  'price_billing',
  'atmosphere_noise',
  'location_access',
  'safety',
  'communication',
] as const

export type NotificationGuestVoiceTopic = (typeof NOTIFICATION_GUEST_VOICE_TOPICS)[number]

const GUEST_VOICE_LINE_KINDS = ['fix_first', 'protect', 'change'] as const
const GUEST_VOICE_KINDS = ['weekly', 'monthly'] as const
const GUEST_VOICE_CHANGES = ['rising', 'falling'] as const
const GUEST_VOICE_POLARITIES = ['complaint', 'praise'] as const

/** One of the page's three "In short" lines, as the fact the email states. */
export type NotificationGuestVoiceLine = Readonly<{
  kind: (typeof GUEST_VOICE_LINE_KINDS)[number]
  topic: NotificationGuestVoiceTopic
  /** Reviews that name it, and reviews with text in the window ("19 of 128"). */
  reviewCount: number
  textReviewCount: number
  /** Stars it may be worth on the window's average, in hundredths (20 is 0.2). */
  upToHundredths?: number
  /** Which way it moved, on a `change` line. */
  change?: (typeof GUEST_VOICE_CHANGES)[number]
  /** Whether the reviews that moved praise it or complain of it, on a `change` line. */
  polarity?: (typeof GUEST_VOICE_POLARITIES)[number]
}>

const MAX_GUEST_VOICE_LINES = 3
const MAX_GUEST_VOICE_COUNT = 1_000_000
/** 5 stars, in hundredths: the most a problem could be worth on a 5-star scale. */
const MAX_UP_TO_HUNDREDTHS = 500

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const takeGuestVoiceCount = (value: unknown): number | undefined =>
  takeIntegerIn(value, 0, MAX_GUEST_VOICE_COUNT)

function parseGuestVoiceLine(value: unknown): NotificationGuestVoiceLine | undefined {
  if (!isRecord(value)) return undefined
  const kind = takeMember(value.kind, GUEST_VOICE_LINE_KINDS)
  const topic = takeMember(value.topic, NOTIFICATION_GUEST_VOICE_TOPICS)
  const reviewCount = takeGuestVoiceCount(value.reviewCount)
  const textReviewCount = takeGuestVoiceCount(value.textReviewCount)
  if (
    kind === undefined ||
    topic === undefined ||
    reviewCount === undefined ||
    textReviewCount === undefined
  ) {
    return undefined
  }
  const upTo = takeGuestVoiceCount(value.upToHundredths)
  const change = takeMember(value.change, GUEST_VOICE_CHANGES)
  const polarity = takeMember(value.polarity, GUEST_VOICE_POLARITIES)
  return {
    kind,
    topic,
    reviewCount,
    textReviewCount,
    // A figure belongs to the line it is for, so a stray one is dropped.
    ...(kind === 'fix_first' && upTo !== undefined && upTo <= MAX_UP_TO_HUNDREDTHS
      ? { upToHundredths: upTo }
      : {}),
    ...(kind === 'change' && change !== undefined ? { change } : {}),
    ...(kind === 'change' && polarity !== undefined ? { polarity } : {}),
  }
}

/** The Guest voice summary fields of an untrusted payload; unknown input is dropped. */
function parseGuestVoiceSummaryFields(
  raw: Readonly<Record<string, unknown>>,
): GuestVoiceSummaryPayloadFields {
  const kind = takeMember(raw.guestVoiceKind, GUEST_VOICE_KINDS)
  const window = takeMember(raw.guestVoiceWindow, GUEST_VOICE_WINDOWS)
  const lines = Array.isArray(raw.guestVoiceLines)
    ? raw.guestVoiceLines
        .slice(0, MAX_GUEST_VOICE_LINES)
        .map(parseGuestVoiceLine)
        .filter((line): line is NotificationGuestVoiceLine => line !== undefined)
    : undefined
  return {
    ...(kind === undefined ? {} : { guestVoiceKind: kind }),
    ...(window === undefined ? {} : { guestVoiceWindow: window }),
    ...(lines === undefined ? {} : { guestVoiceLines: lines }),
  }
}

/** The fields a Guest voice summary notice adds to a payload. */
type GuestVoiceSummaryPayloadFields = Readonly<{
  /** The Monday email, or the roundup of the first Monday of the month. */
  guestVoiceKind?: (typeof GUEST_VOICE_KINDS)[number]
  /** The window the figures were worked out over. */
  guestVoiceWindow?: NotificationGuestVoiceWindow
  /** At most three lines, in the page's order: fix first, protect, change. */
  guestVoiceLines?: readonly NotificationGuestVoiceLine[]
}>
