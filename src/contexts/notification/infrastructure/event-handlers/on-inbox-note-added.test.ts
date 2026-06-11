// Notification context — on-inbox-note-added event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onInboxNoteAdded } from './on-inbox-note-added'
import type { InboxNoteAdded } from '#/contexts/inbox/application/public-api'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  inboxItemId,
  inboxNoteId,
  userId,
} from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const INBOX_ITEM_ID = inboxItemId('item-1')
const NOTE_ID = inboxNoteId('note-1')
const AUTHOR = userId('author-1')
const MANAGER_1 = userId('mgr-1')
const MANAGER_2 = userId('mgr-2')
const NOW = new Date('2026-06-01T12:00:00Z')

const mockEvent: InboxNoteAdded = {
  _tag: 'inbox.inbox_note.added',
  eventId: 'test-event-id',
  correlationId: null,
  inboxItemId: INBOX_ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  userId: AUTHOR,
  noteId: NOTE_ID,
  text: 'Some note text',
  source: 'web',
  occurredAt: NOW,
}

function createFakeDeps() {
  const jobs: Array<{ name: string; data: unknown }> = []
  const addMock = vi.fn(async (name: string, data: unknown) => {
    jobs.push({ name, data })
  })
  const queue = { add: addMock } as unknown as Queue
  const userLookup = {
    findAssignedManagers: vi.fn(),
    findByRole: vi.fn(),
    getEmail: vi.fn(),
    getName: vi.fn(),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
  return { queue, addMock, userLookup, logger, jobs }
}

describe('onInboxNoteAdded (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues a notification job for each manager excluding the note author', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([AUTHOR, MANAGER_1, MANAGER_2])

    await onInboxNoteAdded(deps)(mockEvent)

    expect(deps.queue.add).toHaveBeenCalledTimes(2)
    expect(deps.jobs).toHaveLength(2)
    expect(deps.jobs[0]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: MANAGER_1,
        organizationId: ORG_ID,
        type: 'inbox_note.added',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'New note added',
        body: 'A note was added to an inbox item',
      },
    })
    expect(deps.jobs[1]).toEqual({
      name: INSERT_NOTIFICATION_JOB_NAME,
      data: {
        userId: MANAGER_2,
        organizationId: ORG_ID,
        type: 'inbox_note.added',
        resourceType: 'inbox_item',
        resourceId: INBOX_ITEM_ID,
        eventId: 'test-event-id',
        title: 'New note added',
        body: 'A note was added to an inbox item',
      },
    })
  })

  it('looks up managers by propertyId', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxNoteAdded(deps)(mockEvent)

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(ORG_ID, PROP_ID)
  })

  it('does not enqueue any jobs when all managers are filtered out (self-notification)', async () => {
    // Only the author is a manager — gets filtered out
    deps.userLookup.findAssignedManagers.mockResolvedValue([AUTHOR])

    await onInboxNoteAdded(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('does not enqueue any jobs when no managers are found', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onInboxNoteAdded(deps)(mockEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no recipients after filtering', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([AUTHOR])

    await onInboxNoteAdded(deps)(mockEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { propertyId: PROP_ID, eventId: 'test-event-id' },
      'onInboxNoteAdded: no recipients after filtering, skipping',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findAssignedManagers.mockRejectedValue(new Error('DB down'))

    await expect(onInboxNoteAdded(deps)(mockEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([MANAGER_1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxNoteAdded(deps)(mockEvent)).rejects.toThrow('Queue unavailable')
  })
})
