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

  it('returns true for portal responsibility recovery', () => {
    expect(isUrgent('portal.responsibility_needed')).toBe(true)
  })

  it('returns true for Property responsibility recovery', () => {
    expect(isUrgent('property.responsibility_needed')).toBe(true)
  })

  it('returns true when a Google connection needs reauthorization', () => {
    expect(isUrgent('integration.reauthorization_required')).toBe(true)
  })

  it('returns false for review.created', () => {
    expect(isUrgent('review.created')).toBe(false)
  })

  it('keeps revised and reopened work calm enough to respect quiet hours', () => {
    expect(isUrgent('review.updated')).toBe(false)
    expect(isUrgent('inbox.reopened')).toBe(false)
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

  it('keeps a resolved escalation calm and non-urgent', () => {
    expect(isUrgent('inbox.escalation_resolved')).toBe(false)
  })

  it('returns false for inbox.bulk_assigned', () => {
    expect(isUrgent('inbox.bulk_assigned')).toBe(false)
  })

  it('returns false for inbox_note.added', () => {
    expect(isUrgent('inbox_note.added')).toBe(false)
  })

  it('returns false for goal.completed', () => {
    expect(isUrgent('goal.completed')).toBe(false)
  })

  it('keeps a revised goal result informational', () => {
    expect(isUrgent('goal.result_revised')).toBe(false)
  })

  it('keeps Portal Health attention calm enough to respect quiet hours', () => {
    expect(isUrgent('portal.health_attention')).toBe(false)
  })

  it('exactly 6 types are urgent', () => {
    expect(URGENT_TYPES.size).toBe(6)
  })

  it('every urgent type returns true from isUrgent', () => {
    for (const type of URGENT_TYPES) {
      expect(isUrgent(type)).toBe(true)
    }
  })

  it('all non-urgent types return false', () => {
    const allTypes: NotificationType[] = [
      'review.created',
      'review.updated',
      'feedback.created',
      'reply.pending_approval',
      'reply.approved',
      'reply.rejected',
      'reply.published',
      'reply.publish_failed',
      'inbox.escalated',
      'inbox.escalation_resolved',
      'inbox.reopened',
      'inbox.response_target_halfway',
      'inbox.response_target_passed',
      'inbox.assigned',
      'inbox.bulk_assigned',
      'inbox_note.added',
      'portal.responsibility_needed',
      'portal.health_attention',
      'property.responsibility_needed',
      'integration.reauthorization_required',
      'goal.completed',
      'goal.result_revised',
      'badge.awarded',
    ]
    const nonUrgent = allTypes.filter((t) => !URGENT_TYPES.has(t))
    for (const type of nonUrgent) {
      expect(isUrgent(type)).toBe(false)
    }
  })
})
