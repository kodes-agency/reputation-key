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
export type QualifiedScanId = Brand<string, 'QualifiedScanId'>
export type PortalAccessArtifactId = Brand<string, 'PortalAccessArtifactId'>
export type PortalApprovedDestinationId = Brand<string, 'PortalApprovedDestinationId'>
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
export type RecentActivityEntryId = Brand<string, 'RecentActivityEntryId'>

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

export function qualifiedScanId(id: string): QualifiedScanId {
  return id as QualifiedScanId
}

export function portalAccessArtifactId(id: string): PortalAccessArtifactId {
  return id as PortalAccessArtifactId
}

export function portalApprovedDestinationId(id: string): PortalApprovedDestinationId {
  return id as PortalApprovedDestinationId
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

export type GoogleConnectionId = Brand<string, 'GoogleConnectionId'>
export type MetricReadingId = Brand<string, 'MetricReadingId'>

export function googleConnectionId(id: string): GoogleConnectionId {
  return id as GoogleConnectionId
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

export function recentActivityEntryId(id: string): RecentActivityEntryId {
  return id as RecentActivityEntryId
}

export type NotificationId = Brand<string, 'NotificationId'>
export function notificationId(id: string): NotificationId {
  return id as NotificationId
}

export type NotificationEmailId = Brand<string, 'NotificationEmailId'>
export function notificationEmailId(id: string): NotificationEmailId {
  return id as NotificationEmailId
}

export type NotificationDigestBatchId = Brand<string, 'NotificationDigestBatchId'>
export function notificationDigestBatchId(id: string): NotificationDigestBatchId {
  return id as NotificationDigestBatchId
}

export type NotificationPreferenceId = Brand<string, 'NotificationPreferenceId'>
export function notificationPreferenceId(id: string): NotificationPreferenceId {
  return id as NotificationPreferenceId
}

export type BadgeId = Brand<string, 'BadgeId'>
export function badgeId(id: string): BadgeId {
  return id as BadgeId
}

export type OrganizationBadgeEnablementId = Brand<string, 'OrganizationBadgeEnablementId'>
export function organizationBadgeEnablementId(id: string): OrganizationBadgeEnablementId {
  return id as OrganizationBadgeEnablementId
}

export type LeaderboardSnapshotId = Brand<string, 'LeaderboardSnapshotId'>
export function leaderboardSnapshotId(id: string): LeaderboardSnapshotId {
  return id as LeaderboardSnapshotId
}

export type LeaderboardEntryId = Brand<string, 'LeaderboardEntryId'>
export function leaderboardEntryId(id: string): LeaderboardEntryId {
  return id as LeaderboardEntryId
}
/** Safely strip brand from a branded ID type for use at infrastructure boundaries. */
export function unbrand<T extends string>(branded: T): string {
  return String(branded)
}

/** Strip brand from an array of branded IDs. Useful for Drizzle `inArray()` calls. */
export function unbrandAll<T extends string>(ids: readonly T[]): string[] {
  return ids.map((id) => String(id))
}
