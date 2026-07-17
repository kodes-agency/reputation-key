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
import type { Result } from '#/shared/domain'
import type { InboxItem } from './types'
import type { InboxError } from './errors'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')
const REVIEW_ID = reviewId('rev-1')
const FEEDBACK_ID = feedbackId('fb-1')
const NOW = new Date('2025-06-01T12:00:00Z')
const clock = () => NOW

const baseItemInput = (id: string) => ({
  id: inboxItemId(id),
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  sourceType: 'review' as const,
  sourceId: REVIEW_ID,
  sourceDate: NOW,
  platform: null,
  assignedTo: null,
  clock,
})

const expectInvalid = (result: Result<InboxItem, InboxError>): void => {
  expect(result.isErr()).toBe(true)
  if (result.isErr()) expect(result.error.code).toBe('invalid_input')
}

describe('createInboxItem', () => {
  it('returns Ok with correct defaults (status new, null timestamps)', () => {
    const result = createInboxItem({
      id: inboxItemId('item-1'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      sourceDate: new Date('2025-05-20T10:00:00Z'),
      platform: 'google',
      assignedTo: null,
      clock,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const item = result.value
      expect(item.id).toBe(inboxItemId('item-1'))
      expect(item.status).toBe('open')
      // BQC-1.2: raw source content is never stored — always null.
      expect(item.rating).toBeNull()
      expect(item.snippet).toBeNull()
      expect(item.reviewerName).toBeNull()
      expect(item.closedAt).toBeNull()
      expect(item.escalatedAt).toBeNull()
      expect(item.isEscalated).toBe(false)
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
      sourceDate: new Date('2025-05-21T10:00:00Z'),
      platform: null,
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

  it('returns Err for platform exceeding 50 characters', () => {
    const result = createInboxItem({
      ...baseItemInput('item-5'),
      platform: 'a'.repeat(51),
    })
    expectInvalid(result)
    if (result.isErr()) expect(result.error.message).toContain('Platform')
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
