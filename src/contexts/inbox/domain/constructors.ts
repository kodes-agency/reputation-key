// Inbox context — entity constructors

import { ok, err, type Result } from 'neverthrow'
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

export const createInboxItem = (input: CreateInboxItemInput): Result<InboxItem, InboxError> => {
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
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

export type CreateInboxNoteInput = Readonly<{
  id: InboxNoteId
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  authorUserId: UserId
  text: string
  clock: () => Date
}>

export const createInboxNote = (input: CreateInboxNoteInput): Result<InboxNote, InboxError> => {
  const trimmed = input.text.trim()
  if (trimmed.length === 0) {
    return err(inboxError('invalid_input', 'Note text cannot be empty'))
  }
  return ok({
    id: input.id,
    inboxItemId: input.inboxItemId,
    organizationId: input.organizationId,
    authorUserId: input.authorUserId,
    text: trimmed,
    createdAt: input.clock(),
  })
}
