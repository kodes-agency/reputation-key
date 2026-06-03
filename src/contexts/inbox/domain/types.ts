// Inbox context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type {
  InboxItemId,
  InboxNoteId,
  OrganizationId,
  PropertyId,
  UserId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'

export type InboxStatus = 'new' | 'read' | 'addressed' | 'escalated' | 'archived'
export type SourceType = 'review' | 'feedback'

export type InboxItem = Readonly<{
  id: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  status: InboxStatus
  rating: number | null
  sourceDate: Date
  platform: string | null
  snippet: string | null
  assignedTo: UserId | null
  reviewerName: string | null
  propertyName: string | null
  readAt: Date | null
  escalatedAt: Date | null
  addressedAt: Date | null
  archivedAt: Date | null
  firstReplySubmittedAt: Date | null
  firstReplyPublishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

export type InboxNote = Readonly<{
  id: InboxNoteId
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  userId: UserId
  text: string
  createdAt: Date
}>

/** Detail view includes joined source data. */
export type InboxItemDetail = Readonly<{
  item: InboxItem
  // Review-specific (null for feedback)
  reviewText: string | null
  reviewerProfilePhotoUrl: string | null
  // Feedback-specific (null for reviews)
  feedbackComment: string | null
  feedbackRatingValue: number | null
}>
