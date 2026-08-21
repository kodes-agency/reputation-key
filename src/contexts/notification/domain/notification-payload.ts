// Notification context — content-free render metadata (ADR 0046 r.8).
//
// A notification's user-facing copy is rendered from `type` + this payload at
// READ time (see `notification-templates.ts`), not frozen into a string at
// enqueue time. That is what lets a notification say
//
//   "New 2-star review · Riverside Hotel · waiting 3h"
//
// instead of "New review received", while still obeying the source-content
// boundary.
//
// THE BOUNDARY (ADR 0046 r.8, ADR 0031, BQC-1.2). Payload carries
// "property/resource/status metadata" ONLY:
//
//   ALLOWED   property name (tenant-authored), goal/badge/portal display names
//             (registered non-sensitive), the 1-5 star rating (a numeric fact),
//             actor ROLE, counts, ages in hours, platform enum, internal
//             moderation reason (staff-authored).
//   FORBIDDEN review text, reply text, guest/reviewer name, media URLs,
//             sentiment or any derived score, and any other employee's NAME
//             or email.
//
// `parseNotificationPayload` is the only way a payload enters the domain, and
// it drops every unrecognised key. A new field must be added here AND to
// PROTECTED_FIELD_REGISTRY (`notifications.payload`) — the governance test
// fails otherwise.

/** Star rating as reported by the provider. */
export type NotificationRating = 1 | 2 | 3 | 4 | 5

/**
 * Actor role — we surface WHO acted by role, never by name, because ADR 0046
 * r.8 excludes other employees' data.
 */
export type NotificationActorRole = 'account_admin' | 'property_manager' | 'staff'

export type NotificationPlatform = 'google' | 'portal'

export type NotificationTargetKind = 'portal' | 'portal_group'

export type NotificationPayload = Readonly<{
  /** Tenant-authored property name. Present on every payload we mint. */
  propertyName?: string
  /** 1-5 star rating. Numeric fact, not source content. */
  rating?: NotificationRating
  /** Review source platform. */
  platform?: NotificationPlatform
  /** Hours the resource has been waiting for action, floored. Drives urgency copy. */
  waitingHours?: number
  /** Role of the person whose action produced this notification. */
  actorRole?: NotificationActorRole
  /** Staff-authored moderation reason (reply.rejected only). */
  moderationReason?: string
  /** Tenant-authored goal name (goal.completed). */
  goalName?: string
  /** Badge display name (badge.awarded). */
  badgeName?: string
  /** Portal / portal-group display name — registered non-sensitive. */
  recipientName?: string
  /** Whether the badge target is a portal or a portal group. */
  targetKind?: NotificationTargetKind
  /** Repeat-event count when a row has coalesced. */
  occurrences?: number
}>

const ACTOR_ROLES: Record<string, true> = {
  account_admin: true,
  property_manager: true,
  staff: true,
}

const PLATFORMS: Record<string, true> = { google: true, portal: true }

const TARGET_KINDS: Record<string, true> = { portal: true, portal_group: true }

/** Longest free-ish text we accept. Names, not prose. */
const MAX_NAME_LENGTH = 120
/** Moderation reasons are staff-authored sentences, capped like the event bus caps them. */
const MAX_REASON_LENGTH = 500

/** Trimmed non-empty string under `max`, else undefined. Never throws. */
const takeText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

const takeRating = (value: unknown): NotificationRating | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= 1 && value <= 5 ? (value as NotificationRating) : undefined
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
  set('rating', takeRating(raw.rating))
  set('platform', takeMember(raw.platform, PLATFORMS))
  set('waitingHours', takeCount(raw.waitingHours))
  set('actorRole', takeMember(raw.actorRole, ACTOR_ROLES))
  set('moderationReason', takeText(raw.moderationReason, MAX_REASON_LENGTH))
  set('goalName', takeText(raw.goalName, MAX_NAME_LENGTH))
  set('badgeName', takeText(raw.badgeName, MAX_NAME_LENGTH))
  set('recipientName', takeText(raw.recipientName, MAX_NAME_LENGTH))
  set('targetKind', takeMember(raw.targetKind, TARGET_KINDS))
  set('occurrences', takeCount(raw.occurrences))

  return parsed as NotificationPayload
}

/** True when the payload carries nothing worth persisting. */
export const isEmptyNotificationPayload = (payload: NotificationPayload): boolean =>
  Object.keys(payload).length === 0
