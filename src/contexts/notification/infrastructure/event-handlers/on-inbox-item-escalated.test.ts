// Notification context — on-inbox-item-escalated event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  buildInboxItemEscalatedEvent,
  buildExpectedJob,
  EXPECTED_INBOX_PAYLOAD,
  expectJobsEnqueued,
  NOTIF_TEST_IDS,
} from './test-fixtures'

const escalatedEvent = buildInboxItemEscalatedEvent()

describe('onInboxItemEscalated (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues a facts-only notification job for each admin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expectJobsEnqueued(deps, 2)
    // Was: body 'Inbox item <uuid> has been escalated and requires attention'.
    // The id travels in the deep link; the copy now carries the rating, the
    // property and the waiting age, rendered from these facts.
    expect(deps.jobs[0]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.admin1,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: EXPECTED_INBOX_PAYLOAD,
        audience: { kind: 'account_admin' },
      }),
    )
    expect(deps.jobs[1]).toEqual(
      buildExpectedJob({
        userId: NOTIF_TEST_IDS.admin2,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId: NOTIF_TEST_IDS.inboxItemId,
        payload: EXPECTED_INBOX_PAYLOAD,
        audience: { kind: 'account_admin' },
      }),
    )
  })

  it('puts no identifier anywhere in what the user will read', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await onInboxItemEscalated(deps)(escalatedEvent)

    const payload = (deps.jobs[0]!.data as { payload: unknown }).payload
    expect(JSON.stringify(payload)).not.toContain(NOTIF_TEST_IDS.inboxItemId)
  })

  it('names no actor: an SLA fired, not a colleague', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.userLookup.findActorRole).not.toHaveBeenCalled()
    expect(
      (deps.jobs[0]!.data as { payload: Record<string, unknown> }).payload.actorRole,
    ).toBeUndefined()
  })

  it('looks up admins by organizationId and AccountAdmin role', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      'AccountAdmin',
    )
  })

  it('does not enqueue any jobs when no admins are found', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.queue.add).not.toHaveBeenCalled()
  })

  it('logs a warning when no admins are found', async () => {
    deps.userLookup.findByRole.mockResolvedValue([])

    await onInboxItemEscalated(deps)(escalatedEvent)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { correlationId: undefined },
      'onInboxItemEscalated: no recipients found, skipping',
    )
  })

  it('propagates error from userLookup', async () => {
    deps.userLookup.findByRole.mockRejectedValue(new Error('DB down'))

    await expect(onInboxItemEscalated(deps)(escalatedEvent)).rejects.toThrow('DB down')
  })

  it('propagates error from queue.add', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    deps.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(onInboxItemEscalated(deps)(escalatedEvent)).rejects.toThrow(
      'Queue unavailable',
    )
  })
})
