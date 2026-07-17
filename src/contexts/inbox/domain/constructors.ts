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
  sourceDate: Date
  platform: string | null
  assignedTo: UserId | null
  clock: () => Date
}>

export const createInboxItem = (
  input: CreateInboxItemInput,
): Result<InboxItem, InboxError> => {
  if (input.platform !== null) {
    if (input.platform.length > 50) {
      return err(
        inboxError('invalid_input', 'Platform exceeds 50 characters', {
          platform: input.platform,
        }),
      )
    }
  }

  const now = input.clock()
  return ok({
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: 'open' as InboxStatus,
    // BQC-1.2: raw source content is never stored on inbox items — rating/
    // snippet/reviewerName are sourced live via the eligible review lookup.
    rating: null,
    sourceDate: input.sourceDate,
    platform: input.platform,
    snippet: null,
    assignedTo: input.assignedTo,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
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
