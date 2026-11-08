import { describe, it, expect } from 'vitest'

import {
  inboxBulkReopenCompleted,
  inboxHandlingCycleClosed,
  inboxHandlingCycleOpened,
  inboxHandlingCycleReopened,
  inboxResponseTargetReminderDue,
  inboxItemCreated,
  inboxItemAssigned,
  inboxItemUnassigned,
  inboxItemEscalated,
  inboxItemEscalationResolved,
  inboxNoteAdded,
  inboxItemBulkStatusChanged,
  inboxItemStatusChanged,
} from './events'
import {
  feedbackId,
  inboxItemId,
  inboxNoteId,
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

  it('marks a cycle opened by the command that created its item, and only that one', () => {
    const open = (openedWithItem?: boolean) =>
      inboxHandlingCycleOpened({
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
        triggerEventId: null,
        occurredAt: NOW,
        ...(openedWithItem === undefined ? {} : { openedWithItem }),
      })

    expect(open(true).openedWithItem).toBe(true)
    expect(open().openedWithItem).toBe(false)
  })

  it('marks a reopen that belongs to a bulk command, and only that one', () => {
    const reopen = (bulkId?: string | null) =>
      inboxHandlingCycleReopened({
        inboxItemId: ITEM_ID,
        cycleNumber: 3,
        stateRevision: 4,
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        sourceType: 'review',
        sourceId: reviewId('review-cycle-event-1'),
        sourceRevision: 1,
        reopenReason: 'new_information',
        actorType: 'user',
        userId: USER_ID,
        triggerEventId: null,
        source: 'web',
        occurredAt: NOW,
        ...(bulkId === undefined ? {} : { bulkId }),
      })

    expect(reopen('bulk-1').bulkId).toBe('bulk-1')
    expect(reopen().bulkId).toBeNull()
  })

  describe('inboxBulkReopenCompleted', () => {
    const cycle = (item: string) => ({
      inboxItemId: inboxItemId(item),
      propertyId: PROP_ID,
      sourceType: 'review' as const,
      sourceId: reviewId(`review-${item}`),
      cycleNumber: 2,
      sourceRevision: 1,
      stateRevision: 2,
    })

    it('records every reopened cycle once, in canonical item order', () => {
      const completed = inboxBulkReopenCompleted({
        organizationId: ORG_ID,
        userId: USER_ID,
        bulkId: 'bulk-1',
        reopened: [cycle('item-b'), cycle('item-a')],
        occurredAt: NOW,
      })

      expect(completed).toMatchObject({
        _tag: 'inbox.inbox_items.bulk_reopen_completed',
        userId: USER_ID,
        bulkId: 'bulk-1',
        count: 2,
        source: 'web',
        reopened: [cycle('item-a'), cycle('item-b')],
      })
    })

    it.each([
      ['no reopened cycle', []],
      ['the same item twice', [cycle('item-a'), cycle('item-a')]],
      [
        'more than the bulk limit',
        Array.from({ length: 101 }, (_, i) => cycle(`i-${i}`)),
      ],
      ['a non-positive cycle number', [{ ...cycle('item-a'), cycleNumber: 0 }]],
    ])('refuses %s', (_label, reopened) => {
      expect(() =>
        inboxBulkReopenCompleted({
          organizationId: ORG_ID,
          userId: USER_ID,
          bulkId: 'bulk-1',
          reopened,
          occurredAt: NOW,
        }),
      ).toThrow(/bulk reopen/)
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

describe('Inbox fact envelopes', () => {
  const scope = { inboxItemId: ITEM_ID, organizationId: ORG_ID, occurredAt: NOW }
  type Metadata = {
    propertyId?: ReturnType<typeof propertyId>
    userId?: ReturnType<typeof userId>
    source?: 'web' | 'import'
    correlationId?: string
  }
  const cases = [
    {
      make: (metadata: Metadata) =>
        inboxItemCreated({
          ...scope,
          sourceType: 'review',
          sourceId: reviewId('review-1'),
          ...metadata,
        }),
      fields: { sourceType: 'review', sourceId: reviewId('review-1') },
      tag: 'inbox.inbox_item.created',
    },
    {
      make: (metadata: Metadata) =>
        inboxItemStatusChanged({
          ...scope,
          oldStatus: 'open',
          newStatus: 'closed',
          ...metadata,
        }),
      fields: { oldStatus: 'open', newStatus: 'closed' },
      tag: 'inbox.inbox_item.status_changed',
    },
    {
      make: (metadata: Metadata) =>
        inboxItemAssigned({
          ...scope,
          userId: USER_ID,
          assignedTo: userId('manager-2'),
          previousAssignee: null,
          bulkId: 'bulk-1',
          commandRevision: 4,
          ...metadata,
        }),
      fields: {
        userId: USER_ID,
        assignedTo: userId('manager-2'),
        previousAssignee: null,
        bulkId: 'bulk-1',
        commandRevision: 4,
      },
      tag: 'inbox.inbox_item.assigned',
    },
    {
      make: (metadata: Metadata) =>
        inboxItemUnassigned({
          ...scope,
          previousAssignee: USER_ID,
          bulkId: 'bulk-1',
          commandRevision: 5,
          ...metadata,
        }),
      fields: { previousAssignee: USER_ID, bulkId: 'bulk-1', commandRevision: 5 },
      tag: 'inbox.inbox_item.unassigned',
    },
    {
      make: (metadata: Metadata) => inboxItemEscalated({ ...scope, ...metadata }),
      fields: {},
      tag: 'inbox.inbox_item.escalated',
    },
    {
      make: (metadata: Metadata) =>
        inboxItemEscalationResolved({ ...scope, ...metadata }),
      fields: {},
      tag: 'inbox.inbox_item.escalation_resolved',
    },
    {
      make: (metadata: Metadata) =>
        inboxNoteAdded({ ...scope, noteId: inboxNoteId('note-1'), ...metadata }),
      fields: { noteId: inboxNoteId('note-1') },
      tag: 'inbox.inbox_note.added',
    },
    {
      make: (metadata: Metadata) =>
        inboxItemBulkStatusChanged({
          ...scope,
          oldStatus: 'open',
          newStatus: 'closed',
          bulkId: 'bulk-1',
          ...metadata,
        }),
      fields: { oldStatus: 'open', newStatus: 'closed', bulkId: 'bulk-1' },
      tag: 'inbox.inbox_item.bulk_status_changed',
    },
  ]

  it.each(cases)(
    'keeps the complete default and explicit envelope for $tag',
    ({ make, fields, tag }) => {
      for (const metadata of [
        {},
        {
          propertyId: PROP_ID,
          userId: USER_ID,
          source: 'import' as const,
          correlationId: 'correlation-1',
        },
      ]) {
        expect(make(metadata)).toEqual({
          _tag: tag,
          eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          ...scope,
          propertyId: null,
          userId: null,
          source: 'web',
          correlationId: null,
          ...fields,
          ...metadata,
        })
      }
    },
  )
})

describe('Handling Cycle fact scope', () => {
  const scope = {
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    cycleNumber: 1,
    stateRevision: 1,
    sourceType: 'review' as const,
    sourceId: reviewId('review-1'),
    sourceRevision: 1,
    actorType: 'provider' as const,
    userId: null,
    triggerEventId: null,
    occurredAt: NOW,
  }
  it.each([
    { override: { cycleNumber: 0 }, message: 'cycleNumber must be positive' },
    { override: { sourceRevision: 0 }, message: 'sourceRevision must be positive' },
    { override: { actorType: 'user' as const }, message: 'user actor required' },
    { override: { userId: USER_ID }, message: 'system actor required' },
  ])('refuses $message on every cycle fact', ({ override, message }) => {
    const args = { ...scope, ...override }
    expect(() =>
      inboxHandlingCycleOpened({ ...args, openReason: 'material_revision_changed' }),
    ).toThrow(message)
    expect(() =>
      inboxHandlingCycleClosed({ ...args, closeReason: 'source_ineligible' }),
    ).toThrow(message)
    expect(() =>
      inboxHandlingCycleReopened({ ...args, reopenReason: 'material_revision_changed' }),
    ).toThrow(message)
  })
})
