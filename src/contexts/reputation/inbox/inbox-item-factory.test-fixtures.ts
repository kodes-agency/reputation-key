import type { OrganizationId } from '#/shared/domain/ids'
import type { InboxItem } from '../domain/inbox-types'

/** A private-feedback item with explicit ids, open or closed at `at`. */
export const buildFeedbackItem = (input: {
  id: InboxItem['id']
  organizationId: OrganizationId
  propertyId: InboxItem['propertyId']
  sourceId: InboxItem['sourceId']
  status: 'open' | 'closed'
  at: Date
}): InboxItem => ({
  id: input.id,
  organizationId: input.organizationId,
  propertyId: input.propertyId,
  sourceType: 'feedback',
  sourceId: input.sourceId,
  status: input.status,
  rating: 2,
  sourceDate: input.at,
  platform: null,
  snippet: 'Private feedback',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: input.status === 'closed' ? input.at : null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: input.at,
  updatedAt: input.at,
})
