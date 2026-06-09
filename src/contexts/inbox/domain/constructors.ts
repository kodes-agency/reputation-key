// Inbox context — entity constructors

import { ok, err, type Result } from '#/shared/domain'
import type { InboxItem, InboxNote, InboxStatus, SourceType } from './types'
import { inboxError, type InboxError } from './errors'
import type {
  InboxItemId,
  InboxNoteId,
  OrganizationId,
  PropertyId,
  UserId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'

export type CreateInboxItemInput = Readonly<{
  id: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  rating: number | null
  sourceDate: Date
  platform: string | null
  snippet: string | null
  assignedTo: UserId | null
  clock: () => Date
}>

export const createInboxItem = (
  input: CreateInboxItemInput,
): Result<InboxItem, InboxError> => {
  // Validate strings
  if (input.snippet !== null) {
    const trimmed = input.snippet.trim()
    if (trimmed.length > 10000) {
      return err(
        inboxError('invalid_input', 'Snippet exceeds 10000 characters', {
          snippet: input.snippet,
        }),
      )
    }
  }
  if (input.platform !== null) {
    if (input.platform.length > 50) {
      return err(
        inboxError('invalid_input', 'Platform exceeds 50 characters', {
          platform: input.platform,
        }),
      )
    }
  }
  if (input.rating !== null && (input.rating < 1 || input.rating > 5)) {
    return err(
      inboxError('invalid_input', 'Rating must be between 1 and 5', {
        rating: input.rating,
      }),
    )
  }

  const now = input.clock()
  return ok({
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: 'new' as InboxStatus,
    rating: input.rating,
    sourceDate: input.sourceDate,
    platform: input.platform,
    snippet: input.snippet,
    assignedTo: input.assignedTo,
    reviewerName: null,
    propertyName: null,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

export type CreateInboxNoteInput = Readonly<{
  id: InboxNoteId
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  userId: UserId
  text: string
  clock: () => Date
}>

export const createInboxNote = (
  input: CreateInboxNoteInput,
): Result<InboxNote, InboxError> => {
  const trimmed = input.text.trim()
  if (trimmed.length === 0) {
    return err(inboxError('invalid_input', 'Note text cannot be empty'))
  }
  return ok({
    id: input.id,
    inboxItemId: input.inboxItemId,
    organizationId: input.organizationId,
    userId: input.userId,
    text: trimmed,
    createdAt: input.clock(),
  })
}
