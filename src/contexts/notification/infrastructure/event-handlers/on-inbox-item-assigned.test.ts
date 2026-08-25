// Notification context — on-inbox-item-assigned event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxItemAssigned } from './on-inbox-item-assigned'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  EXPECTED_INBOX_PAYLOAD,
} from './test-fixtures'
import type { InboxItemAssigned } from '#/contexts/inbox/application/public-api'
import { organizationId, propertyId, inboxItemId, userId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const INBOX_ITEM_ID = inboxItemId('item-1')
const ASSIGNED_TO = userId('user-1')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: InboxItemAssigned = {
  _tag: 'inbox.inbox_item.assigned',
  eventId: 'test-event-id',
  correlationId: null,
  inboxItemId: INBOX_ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  userId: userId('assigner-1'),
  assignedTo: ASSIGNED_TO,
  source: 'web',
  occurredAt: NOW,
}

describe('onInboxItemAssigned (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a notification job carrying the item facts and the assigner ROLE', async () => {
    await onInboxItemAssigned(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(1)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: ASSIGNED_TO,
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        type: 'inbox.assigned',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        payload: { ...EXPECTED_INBOX_PAYLOAD, actorRole: 'property_manager' },
        audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM_ID },
      },
    })
  })

  it('resolves the ROLE of the assigner, never their identity', async () => {
    await onInboxItemAssigned(deps)(mockEvent)

    expect(deps.userLookup.findActorRole).toHaveBeenCalledWith(
      userId('assigner-1'),
      ORG_ID,
    )
    // No name/email lookup happens at all — ADR 0046 r.8.
    expect(deps.userLookup.getName).not.toHaveBeenCalled()
    expect(deps.userLookup.getEmail).not.toHaveBeenCalled()
  })

  it('still enqueues when the facts lookup fails, with degraded copy', async () => {
    deps.inboxItemLookup.findInboxItemFacts.mockRejectedValue(new Error('DB down'))

    await onInboxItemAssigned(deps)(mockEvent)

    expect(deps.jobs).toHaveLength(1)
    expect((deps.jobs[0]!.data as { payload: unknown }).payload).toEqual({
      actorRole: 'property_manager',
    })
  })

  it('propagates error from queue.add', async () => {
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxItemAssigned(deps)(mockEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
