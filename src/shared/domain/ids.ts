// Branded ID types for domain objects
// Each ID is a distinct type that can't be accidentally substituted for another.
// Per architecture: "always explicit" — no ambient ID context, always pass orgId.
import type { Brand } from './brand'

export type OrganizationId = Brand<string, 'OrganizationId'>
export type UserId = Brand<string, 'UserId'>
export type PropertyId = Brand<string, 'PropertyId'>
export type ReviewId = Brand<string, 'ReviewId'>
export type ReplyId = Brand<string, 'ReplyId'>
export type PortalId = Brand<string, 'PortalId'>
export type ScanEventId = Brand<string, 'ScanEventId'>
export type RatingId = Brand<string, 'RatingId'>
export type FeedbackId = Brand<string, 'FeedbackId'>
export type TeamId = Brand<string, 'TeamId'>
export type StaffId = Brand<string, 'StaffId'>
export type StaffAssignmentId = Brand<string, 'StaffAssignmentId'>
export type PortalLinkCategoryId = Brand<string, 'PortalLinkCategoryId'>
export type PortalLinkId = Brand<string, 'PortalLinkId'>
export type InboxItemId = Brand<string, 'InboxItemId'>
export type InboxNoteId = Brand<string, 'InboxNoteId'>
export type PortalGroupId = Brand<string, 'PortalGroupId'>
export type GoalId = Brand<string, 'GoalId'>
export type GoalProgressId = Brand<string, 'GoalProgressId'>

// Convenience constructors — each wraps brandId with the correct tag.
// These are the only acceptable `as` casts: branded ID parsing.
export function organizationId(id: string): OrganizationId {
  return id as OrganizationId
}
export function userId(id: string): UserId {
  return id as UserId
}
export function propertyId(id: string): PropertyId {
  return id as PropertyId
}
export function reviewId(id: string): ReviewId {
  return id as ReviewId
}
export function replyId(id: string): ReplyId {
  return id as ReplyId
}
export function portalId(id: string): PortalId {
  return id as PortalId
}

export function scanEventId(id: string): ScanEventId {
  return id as ScanEventId
}

export function ratingId(id: string): RatingId {
  return id as RatingId
}

export function feedbackId(id: string): FeedbackId {
  return id as FeedbackId
}

export function teamId(id: string): TeamId {
  return id as TeamId
}
export function staffId(id: string): StaffId {
  return id as StaffId
}
export function staffAssignmentId(id: string): StaffAssignmentId {
  return id as StaffAssignmentId
}

export function portalLinkCategoryId(id: string): PortalLinkCategoryId {
  return id as PortalLinkCategoryId
}
export function portalLinkId(id: string): PortalLinkId {
  return id as PortalLinkId
}

export function inboxItemId(id: string): InboxItemId {
  return id as InboxItemId
}
export function inboxNoteId(id: string): InboxNoteId {
  return id as InboxNoteId
}

export type InvitationId = Brand<string, 'InvitationId'>
export function invitationId(id: string): InvitationId {
  return id as InvitationId
}

export type GbpCacheEntryId = Brand<string, 'GbpCacheEntryId'>
export function gbpCacheEntryId(id: string): GbpCacheEntryId {
  return id as GbpCacheEntryId
}

export type GoogleConnectionId = Brand<string, 'GoogleConnectionId'>
export type GbpImportJobId = Brand<string, 'GbpImportJobId'>
export type MetricReadingId = Brand<string, 'MetricReadingId'>

export function googleConnectionId(id: string): GoogleConnectionId {
  return id as GoogleConnectionId
}

export function gbpImportJobId(id: string): GbpImportJobId {
  return id as GbpImportJobId
}

export function metricReadingId(id: string): MetricReadingId {
  return id as MetricReadingId
}

export function goalId(id: string): GoalId {
  return id as GoalId
}
export function goalProgressId(id: string): GoalProgressId {
  return id as GoalProgressId
}
export function portalGroupId(id: string): PortalGroupId {
  return id as PortalGroupId
}

/** Safely strip brand from a branded ID type for use at infrastructure boundaries. */
export function unbrand<T extends string>(branded: T): string {
  return String(branded)
}

/** Strip brand from an array of branded IDs. Useful for Drizzle `inArray()` calls. */
export function unbrandAll<T extends string>(ids: readonly T[]): string[] {
  return ids.map((id) => String(id))
}
