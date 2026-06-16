// Notification context — on-inbox-note-added event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxNoteAdded } from './on-inbox-note-added'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildInboxNoteAddedEvent,
  buildExpectedJob,
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

  it('enqueues a notification job for each manager excluding the note author', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([
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
        title: 'New note added',
        body: 'A note was added to an inbox item',
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.manager2,
        type: 'inbox_note.added',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        title: 'New note added',
        body: 'A note was added to an inbox item',
      }),
    )
  })

  it('looks up managers by propertyId', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      NOTIF_TEST_IDS.propId,
    )
  })

  it('does not enqueue any jobs when all managers are filtered out (self-notification)', async () => {
    // Only the author is a manager — gets filtered out
    deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.authorId])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('does not enqueue any jobs when no managers are found', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no recipients after filtering', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([NOTIF_TEST_IDS.authorId])

    await onInboxNoteAdded(deps)(noteAddedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { propertyId: NOTIF_TEST_IDS.propId, eventId: NOTIF_TEST_IDS.eventId },
      'onInboxNoteAdded: no recipients after filtering, skipping',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findAssignedManagers.mockRejectedValue(new Error('DB down'))

    await expect(onInboxNoteAdded(deps)(noteAddedEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    stubManagerForQueueAddError(deps)

    await expect(onInboxNoteAdded(deps)(noteAddedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
