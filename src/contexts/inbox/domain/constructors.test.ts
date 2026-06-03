// Inbox context — entity constructors tests

import { describe, it, expect } from 'vitest'
import { createInboxItem, createInboxNote } from './constructors'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  userId,
  reviewId,
  feedbackId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')
const REVIEW_ID = reviewId('rev-1')
const FEEDBACK_ID = feedbackId('fb-1')
const NOW = new Date('2025-06-01T12:00:00Z')
const clock = () => NOW

describe('createInboxItem', () => {
  it('returns Ok with correct defaults (status new, null timestamps)', () => {
    const result = createInboxItem({
      id: inboxItemId('item-1'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      rating: 4,
      sourceDate: new Date('2025-05-20T10:00:00Z'),
      platform: 'google',
      snippet: 'Great experience!',
      assignedTo: null,
      clock,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const item = result.value
      expect(item.id).toBe(inboxItemId('item-1'))
      expect(item.status).toBe('new')
      expect(item.rating).toBe(4)
      expect(item.readAt).toBeNull()
      expect(item.escalatedAt).toBeNull()
      expect(item.addressedAt).toBeNull()
      expect(item.archivedAt).toBeNull()
      expect(item.createdAt).toBe(NOW)
      expect(item.updatedAt).toBe(NOW)
    }
  })

  it('returns Ok for feedback source type', () => {
    const result = createInboxItem({
      id: inboxItemId('item-2'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'feedback',
      sourceId: FEEDBACK_ID,
      rating: null,
      sourceDate: new Date('2025-05-21T10:00:00Z'),
      platform: null,
      snippet: null,
      assignedTo: USER_ID,
      clock,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const item = result.value
      expect(item.sourceType).toBe('feedback')
      expect(item.rating).toBeNull()
      expect(item.assignedTo).toBe(USER_ID)
    }
  })

  it('returns Err for rating below 1', () => {
    const result = createInboxItem({
      id: inboxItemId('item-3'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      rating: 0,
      sourceDate: NOW,
      platform: null,
      snippet: null,
      assignedTo: null,
      clock,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.context).toEqual({ rating: 0 })
    }
  })

  it('returns Err for rating above 5', () => {
    const result = createInboxItem({
      id: inboxItemId('item-4'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      rating: 6,
      sourceDate: NOW,
      platform: null,
      snippet: null,
      assignedTo: null,
      clock,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.context).toEqual({ rating: 6 })
    }
  })

  it('returns Err for platform exceeding 50 characters', () => {
    const result = createInboxItem({
      id: inboxItemId('item-5'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      rating: null,
      sourceDate: NOW,
      platform: 'a'.repeat(51),
      snippet: null,
      assignedTo: null,
      clock,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.message).toContain('Platform')
    }
  })

  it('returns Err for snippet exceeding 10000 characters', () => {
    const result = createInboxItem({
      id: inboxItemId('item-6'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      rating: null,
      sourceDate: NOW,
      platform: null,
      snippet: 'a'.repeat(10001),
      assignedTo: null,
      clock,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.message).toContain('Snippet')
    }
  })
})

describe('createInboxNote', () => {
  it('returns Ok with trimmed text', () => {
    const result = createInboxNote({
      id: inboxNoteId('note-1'),
      inboxItemId: inboxItemId('item-1'),
      organizationId: ORG_ID,
      userId: USER_ID,
      text: '  Follow up with guest  ',
      clock,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const note = result.value
      expect(note.text).toBe('Follow up with guest')
      expect(note.id).toBe(inboxNoteId('note-1'))
      expect(note.inboxItemId).toBe(inboxItemId('item-1'))
      expect(note.organizationId).toBe(ORG_ID)
      expect(note.userId).toBe(USER_ID)
      expect(note.createdAt).toBe(NOW)
    }
  })

  it('returns Err for empty text', () => {
    const result = createInboxNote({
      id: inboxNoteId('note-2'),
      inboxItemId: inboxItemId('item-1'),
      organizationId: ORG_ID,
      userId: USER_ID,
      text: '',
      clock,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
    }
  })

  it('returns Err for whitespace-only text', () => {
    const result = createInboxNote({
      id: inboxNoteId('note-3'),
      inboxItemId: inboxItemId('item-1'),
      organizationId: ORG_ID,
      userId: USER_ID,
      text: '   ',
      clock,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
    }
  })
})
