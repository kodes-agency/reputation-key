// Notification context — on-inbox-note-added event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxNoteAdded } from './on-inbox-note-added'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildInboxNoteAddedEvent,
  buildExpectedJob,
  EXPECTED_INBOX_PAYLOAD,
  expectJobsEnqueued,
  stubManagerForQueueAddError,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const noteAddedEvent = buildInboxNoteAddedEvent()

describe('onInboxNoteAdded (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('notifies current Property responsibility for unassigned review work, excluding the author', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.authorId,
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager1,
        type: 'inbox_note.added',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: { ...EXPECTED_INBOX_PAYLOAD, actorRole: 'property_manager' },
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: NOTIF_TEST_IDS.propId },
        },
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager2,
        type: 'inbox_note.added',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: { ...EXPECTED_INBOX_PAYLOAD, actorRole: 'property_manager' },
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: NOTIF_TEST_IDS.propId },
        },
      }),
    )
  })

  it('looks up managers by propertyId', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      NOTIF_TEST_IDS.propId,
    )
  })

  it('does not enqueue any jobs when all managers are filtered out (self-notification)', async () => {
    // Only the author is responsible — gets filtered out.
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.authorId])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('does not enqueue any jobs when no managers are found', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no recipients after filtering', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.authorId])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { correlationId: undefined },
      'onInboxNoteAdded: no recipients after filtering, skipping',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.responsibleManagers.findForProperty.mockRejectedValue(new Error('DB down'))

    await expect(onInboxNoteAdded(deps)(noteAddedEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    stubManagerForQueueAddError(deps)

    await expect(onInboxNoteAdded(deps)(noteAddedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })

  it('narrows routine collaboration to the explicit assignee after claim', async () => {
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: NOTIF_TEST_IDS.propId,
      portalId: null,
      assignedTo: NOTIF_TEST_IDS.manager1,
      propertyName: 'Riverside Hotel',
      rating: 2,
      sourceType: 'review',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    })
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager2])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.jobs).toHaveLength(1)
    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ userId: NOTIF_TEST_IDS.manager1 }),
    )
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
  })
})
