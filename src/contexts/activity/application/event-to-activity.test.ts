import { describe, it, expect } from 'vitest'
import { eventToActivity } from '../application/event-to-activity'
import {
  inboxItemCreated,
  inboxItemStatusChanged,
  inboxItemAssigned,
  inboxItemUnassigned,
  inboxNoteAdded,
  inboxItemEscalated,
  inboxItemBulkStatusChanged,
} from '#/contexts/inbox/domain/events'
import {
  reviewReplyPublished,
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyRejected,
  reviewCreated,
  reviewUpdated,
} from '#/contexts/review/domain/events'
import { metricRecorded } from '#/contexts/metric/domain/events'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  userId,
  reviewId,
  replyId,
  metricReadingId,
} from '#/shared/domain/ids'

describe('eventToActivity', () => {
  it('maps inbox.item.created', () => {
    const event = inboxItemCreated({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      sourceType: 'review',
      sourceId: reviewId('rev-1'),
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('created')
    expect(result!.resourceType).toBe('inbox_item')
    expect(result!.resourceId).toBe('item-1')
    expect(result!.propertyId).toBe('prop-1')
    expect(result!.organizationId).toBe('org-1')
    expect(result!.payload.subject).toBe('inbox_item')
    expect(result!.payload.from).toBeNull()
    expect(result!.payload.to).toBeNull()
    expect(result!.payload.detail).toBe('review')
  })

  it('maps inbox.status.changed', () => {
    const event = inboxItemStatusChanged({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      oldStatus: 'new',
      newStatus: 'read',
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('changed')
    expect(result!.resourceType).toBe('inbox_item')
    expect(result!.resourceId).toBe('item-1')
    expect(result!.propertyId).toBeNull()
    expect(result!.payload.subject).toBe('status')
    expect(result!.payload.from).toBe('new')
    expect(result!.payload.to).toBe('read')
  })

  it('maps inbox.item.escalated', () => {
    const event = inboxItemEscalated({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      oldStatus: 'new',
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('escalated')
    expect(result!.resourceType).toBe('inbox_item')
    expect(result!.payload.subject).toBe('inbox_item')
    expect(result!.payload.from).toBe('new')
    expect(result!.payload.to).toBe('escalated')
  })

  it('maps inbox.item.assigned', () => {
    const event = inboxItemAssigned({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      assignedTo: userId('user-1'),
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('assigned')
    expect(result!.resourceType).toBe('inbox_item')
    expect(result!.payload.subject).toBe('inbox_item')
    expect(result!.payload.from).toBeNull()
    expect(result!.payload.to).toBe('user-1')
  })

  it('maps inbox.item.unassigned', () => {
    const event = inboxItemUnassigned({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      previousAssignee: userId('user-1'),
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('unassigned')
    expect(result!.resourceType).toBe('inbox_item')
    expect(result!.payload.subject).toBe('inbox_item')
    expect(result!.payload.from).toBe('user-1')
    expect(result!.payload.to).toBeNull()
  })

  it('maps inbox.note.added', () => {
    const text = 'This is a note text'

    const event = inboxNoteAdded({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      noteId: inboxNoteId('note-1'),
      text,
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('added')
    expect(result!.resourceType).toBe('note')
    expect(result!.resourceId).toBe('note-1')
    expect(result!.payload.subject).toBe('note')
    expect(result!.payload.from).toBeNull()
    expect(result!.payload.to).toBeNull()
    expect(result!.payload.detail).toBe(text)
  })

  it('truncates long note text in payload.detail', () => {
    const longText = 'a'.repeat(200)

    const event = inboxNoteAdded({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      noteId: inboxNoteId('note-1'),
      text: longText,
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.payload.detail).toBe('a'.repeat(100) + '...')
    expect(result!.payload.detail!.length).toBe(103)
  })

  it('maps inbox.bulk.status.changed', () => {
    const event = inboxItemBulkStatusChanged({
      inboxItemId: inboxItemId('item-1'),
      organizationId: organizationId('org-1'),
      oldStatus: 'new',
      newStatus: 'archived',
      bulkId: 'bulk-1',
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('changed')
    expect(result!.resourceType).toBe('inbox_item')
    expect(result!.payload.subject).toBe('status')
    expect(result!.payload.from).toBe('new')
    expect(result!.payload.to).toBe('archived')
    expect(result!.payload.bulkId).toBe('bulk-1')
  })

  it('maps reply.published', () => {
    const event = reviewReplyPublished({
      replyId: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('published')
    expect(result!.resourceType).toBe('reply')
    expect(result!.resourceId).toBe('reply-1')
    expect(result!.propertyId).toBe('prop-1')
    expect(result!.payload.subject).toBe('reply')
  })

  it('maps reply.submitted', () => {
    const event = reviewReplySubmitted({
      replyId: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('submitted')
    expect(result!.resourceType).toBe('reply')
    expect(result!.propertyId).toBe('prop-1')
    expect(result!.payload.subject).toBe('reply')
  })

  it('maps reply.approved', () => {
    const event = reviewReplyApproved({
      replyId: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('approved')
    expect(result!.resourceType).toBe('reply')
    expect(result!.propertyId).toBe('prop-1')
  })

  it('maps reply.rejected with reason', () => {
    const event = reviewReplyRejected({
      replyId: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      reason: 'Inappropriate tone',
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('rejected')
    expect(result!.resourceType).toBe('reply')
    expect(result!.payload.detail).toBe('Inappropriate tone')
  })

  it('maps reply.rejected with null reason', () => {
    const event = reviewReplyRejected({
      replyId: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      reason: null,
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).not.toBeNull()
    expect(result!.action).toBe('rejected')
    expect(result!.payload.detail).toBeNull()
  })

  it('returns null for excluded events (review.created)', () => {
    const event = reviewCreated({
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      platform: 'google',
      externalId: 'ext-1',
      rating: 5,
      reviewText: null,
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).toBeNull()
  })

  it('returns null for excluded events (metric.recorded)', () => {
    const event = metricRecorded({
      readingId: metricReadingId('reading-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: null,
      groupId: null,
      metricKey: 'portal.scan',
      value: 42,
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).toBeNull()
  })

  it('returns null for other excluded events (review.updated)', () => {
    const event = reviewUpdated({
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      platform: 'google',
      externalId: 'ext-1',
      rating: 4,
      reviewText: 'Updated text',
      occurredAt: new Date(),
    })

    const result = eventToActivity(event)

    expect(result).toBeNull()
  })
})
