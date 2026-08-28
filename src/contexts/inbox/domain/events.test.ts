import { describe, it, expect } from 'vitest'

import {
  inboxHandlingCycleClosed,
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  inboxResponseTargetReminderDue,
  inboxItemCreated,
  inboxItemStatusChanged,
} from './events'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')
const ITEM_ID = inboxItemId('item-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('inbox events', () => {
  it('inboxItemCreated generates eventId', () => {
    const event = inboxItemCreated({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: 'rev-1' as unknown as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      userId: USER_ID,
      source: 'web',
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('inbox.inbox_item.created')
  })

  it('inboxItemStatusChanged works', () => {
    const event = inboxItemStatusChanged({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      oldStatus: 'open',
      newStatus: 'closed',
      userId: USER_ID,
      source: 'web',
      occurredAt: NOW,
    })
    expect(event._tag).toBe('inbox.inbox_item.status_changed')
  })

  it('records identifier-only opened, closed, and reopened cycle facts', () => {
    const opened = inboxHandlingCycleOpened({
      inboxItemId: ITEM_ID,
      cycleNumber: 2,
      stateRevision: 3,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: reviewId('review-cycle-event-1'),
      sourceRevision: 2,
      openReason: 'material_revision_changed',
      actorType: 'provider',
      userId: null,
      triggerEventId: 'review-updated-event-2',
      occurredAt: NOW,
    })
    const closed = inboxHandlingCycleClosed({
      inboxItemId: ITEM_ID,
      cycleNumber: 1,
      stateRevision: 2,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'feedback',
      sourceId: feedbackId('feedback-cycle-event-1'),
      sourceRevision: 1,
      closeReason: 'guest_withdrawn',
      actorType: 'guest',
      userId: null,
      triggerEventId: 'guest-retracted-event-1',
      occurredAt: NOW,
    })
    const reopened = inboxHandlingCycleReopened({
      inboxItemId: ITEM_ID,
      cycleNumber: 3,
      stateRevision: 4,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'feedback',
      sourceId: feedbackId('feedback-cycle-event-1'),
      sourceRevision: 1,
      reopenReason: 'new_information',
      actorType: 'user',
      userId: USER_ID,
      triggerEventId: null,
      source: 'web',
      occurredAt: NOW,
    })

    expect(opened).toMatchObject({
      _tag: 'inbox.handling_cycle.opened',
      openReason: 'material_revision_changed',
      sourceId: 'review-cycle-event-1',
      triggerEventId: 'review-updated-event-2',
    })
    expect(closed).toMatchObject({
      _tag: 'inbox.handling_cycle.closed',
      closeReason: 'guest_withdrawn',
      actorType: 'guest',
      userId: null,
    })
    expect(reopened).toMatchObject({
      _tag: 'inbox.handling_cycle.reopened',
      reopenReason: 'new_information',
      actorType: 'user',
      userId: USER_ID,
    })
  })

  it('generates a fresh event envelope for a due response-target reminder', () => {
    const first = inboxResponseTargetReminderDue({
      inboxItemId: ITEM_ID,
      cycleNumber: 1,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date('2026-06-01T11:00:00Z'),
      occurredAt: NOW,
    })
    const second = inboxResponseTargetReminderDue({
      inboxItemId: ITEM_ID,
      cycleNumber: 1,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date('2026-06-01T11:00:00Z'),
      occurredAt: NOW,
    })

    expect(first.eventId).not.toBe('')
    expect(first.eventId).not.toBe(second.eventId)
  })
})
