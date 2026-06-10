// Notification context — isUrgent domain function tests

import { describe, it, expect } from 'vitest'
import { isUrgent, URGENT_TYPES } from './types'
import type { NotificationType } from './types'

describe('isUrgent', () => {
  it('returns true for reply.pending_approval', () => {
    expect(isUrgent('reply.pending_approval')).toBe(true)
  })

  it('returns true for reply.publish_failed', () => {
    expect(isUrgent('reply.publish_failed')).toBe(true)
  })

  it('returns true for inbox.escalated', () => {
    expect(isUrgent('inbox.escalated')).toBe(true)
  })

  it('returns false for review.created', () => {
    expect(isUrgent('review.created')).toBe(false)
  })

  it('returns false for feedback.created', () => {
    expect(isUrgent('feedback.created')).toBe(false)
  })

  it('returns false for reply.approved', () => {
    expect(isUrgent('reply.approved')).toBe(false)
  })

  it('returns false for reply.rejected', () => {
    expect(isUrgent('reply.rejected')).toBe(false)
  })

  it('returns false for reply.published', () => {
    expect(isUrgent('reply.published')).toBe(false)
  })

  it('returns false for inbox.assigned', () => {
    expect(isUrgent('inbox.assigned')).toBe(false)
  })

  it('returns false for inbox_note.added', () => {
    expect(isUrgent('inbox_note.added')).toBe(false)
  })

  it('returns false for goal.completed', () => {
    expect(isUrgent('goal.completed')).toBe(false)
  })

  it('exactly 3 types are urgent', () => {
    expect(URGENT_TYPES.size).toBe(3)
  })

  it('every urgent type returns true from isUrgent', () => {
    for (const type of URGENT_TYPES) {
      expect(isUrgent(type)).toBe(true)
    }
  })

  it('all non-urgent types return false', () => {
    const allTypes: NotificationType[] = [
      'review.created',
      'feedback.created',
      'reply.pending_approval',
      'reply.approved',
      'reply.rejected',
      'reply.published',
      'reply.publish_failed',
      'inbox.escalated',
      'inbox.assigned',
      'inbox_note.added',
      'goal.completed',
    ]
    const nonUrgent = allTypes.filter((t) => !URGENT_TYPES.has(t))
    for (const type of nonUrgent) {
      expect(isUrgent(type)).toBe(false)
    }
  })
})
