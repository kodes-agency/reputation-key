// Notification context — the shared inbox fan-out.
//
// The bus handler's own suite (event-handlers/on-inbox-item-created.test.ts)
// covers recipient resolution and the payload allowlist through the handler.
// What is pinned here is what the fan-out adds for its other two callers: the
// outcome it reports back (so the durable consumer can choose a receipt status
// and the sweep can count) and the deterministic job id.

import { describe, it, expect, beforeEach } from 'vitest'
import { fanoutInboxItemNotifications } from './inbox-notification-fanout'
import {
  createEventHandlerDeps,
  type FakeEventHandlerDeps,
  NOTIF_TEST_IDS,
} from './event-handlers/test-fixtures'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { unbrand } from '#/shared/domain/ids'

const input = (overrides: Record<string, unknown> = {}) => ({
  inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceType: 'review',
  eventId: 'event-1',
  ...overrides,
})

describe('fanoutInboxItemNotifications', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('reports how many recipients it enqueued for', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    const outcome = await fanoutInboxItemNotifications(deps, input())

    expect(outcome).toEqual({ kind: 'enqueued', recipients: 2 })
    expect(deps.jobs).toHaveLength(2)
  })

  it('distinguishes the three reasons nothing was enqueued', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    await expect(
      fanoutInboxItemNotifications(deps, input({ sourceType: 'goal' })),
    ).resolves.toEqual({ kind: 'skipped', reason: 'unknown_source' })

    await expect(
      fanoutInboxItemNotifications(deps, input({ propertyId: null })),
    ).resolves.toEqual({ kind: 'skipped', reason: 'no_property' })

    deps.responsibleManagers.findForProperty.mockResolvedValue([])
    deps.userLookup.findByRole.mockResolvedValue([])
    await expect(fanoutInboxItemNotifications(deps, input())).resolves.toEqual({
      kind: 'skipped',
      reason: 'no_recipients',
    })

    expect(deps.jobs).toHaveLength(0)
  })

  it('stamps a deterministic job id per recipient when a scope is given, so a redelivery converges', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await fanoutInboxItemNotifications(deps, input({ jobIdScope: 'event-1' }))
    // A second delivery of the same event produces the same two ids.
    await fanoutInboxItemNotifications(deps, input({ jobIdScope: 'event-1' }))

    expect(deps.jobs.map((job) => job.opts)).toEqual([
      { jobId: 'event-1-mgr-1' },
      { jobId: 'event-1-mgr-2' },
      { jobId: 'event-1-mgr-1' },
      { jobId: 'event-1-mgr-2' },
    ])
  })

  it('omits the options argument entirely without a scope, so the queue policy wrapper decides', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    await fanoutInboxItemNotifications(deps, input())

    expect(deps.addMock).toHaveBeenCalledWith(
      INSERT_NOTIFICATION_JOB_NAME,
      expect.objectContaining({ resourceId: NOTIF_TEST_IDS.inboxItemId }),
    )
  })

  it('carries the caller-supplied eventId onto the job, so a backfilled row is identifiable', async () => {
    deps.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])

    await fanoutInboxItemNotifications(deps, input({ eventId: 'reconcile:item-1' }))

    expect(deps.jobs[0]!.data).toEqual(
      expect.objectContaining({ eventId: 'reconcile:item-1' }),
    )
  })
})
