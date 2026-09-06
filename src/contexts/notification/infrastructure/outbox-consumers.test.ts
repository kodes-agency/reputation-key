// Notification context — durable outbox consumer for inbox.inbox_item.created.
//
// What is load-bearing here: the consumer registers under the exact identity
// both governance catalogues declare, it writes a receipt for every terminal
// outcome (a consumer that returns without a receipt is redelivered forever),
// and it enqueues with a deterministic job id so a redelivery in the window
// between the enqueue and the receipt converges instead of coalescing a second
// arrival onto the user's unread row.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
  type ConsumerEvent,
} from '#/shared/outbox/consumer-registry'
import {
  handleNotificationInboxItemCreated,
  registerNotificationConsumers,
  ON_INBOX_ITEM_CREATED_CONSUMER,
  type NotificationConsumerDeps,
} from './outbox-consumers'
import {
  createNotificationConsumerDeps,
  type FakeNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import { unbrand } from '#/shared/domain/ids'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '30000000-0000-4000-8000-000000000001'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.inbox_item.created',
  eventVersion: 1,
  payload: {
    inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    sourceType: 'review',
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: 'inbox',
  sourceAggregateId: unbrand(NOTIF_TEST_IDS.inboxItemId),
  recordedAt: '2026-06-01T11:59:00.000Z',
  ...overrides,
})

type Deps = NotificationConsumerDeps & { fakes: FakeNotificationConsumerDeps }

const makeDeps = (): Deps => {
  const fakes = createNotificationConsumerDeps()
  fakes.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: fakes.inboxItemLookup,
    clock: fakes.clock,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

describe('notification durable outbox consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers the durable consumer identity declared in governance', () => {
    const deps = makeDeps()
    registerNotificationConsumers(consumerRegistry, deps)

    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'inbox.inbox_item.created',
      consumerName: 'notification.on-inbox-item-created',
    })
    expect(deps.fakes.logger.info).toHaveBeenCalledWith(
      'Notification consumers registered with outbox dispatcher (1 consumer)',
    )
  })

  it('enqueues one insert-notification job per recipient and records an applied receipt', async () => {
    const deps = makeDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])

    await expect(handleNotificationInboxItemCreated(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.fakes.jobs).toHaveLength(2)
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_ITEM_CREATED_CONSUMER,
      'applied',
    )
  })

  it('gives a redelivered event the same job ids, so the queue collapses it', async () => {
    const deps = makeDeps()

    await handleNotificationInboxItemCreated(deps, event())
    await handleNotificationInboxItemCreated(deps, event())

    expect(deps.fakes.jobs.map((job) => job.opts)).toEqual([
      { jobId: `${EVENT_ID}-mgr-1` },
      { jobId: `${EVENT_ID}-mgr-1` },
    ])
  })

  it('resolves a missing sourceType and propertyId from the inbox item', async () => {
    const deps = makeDeps()
    deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: 'prop-from-item',
      portalId: 'portal-from-item',
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: 5,
      sourceType: 'feedback',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    })
    deps.fakes.responsibleManagers.findForPortal.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
    ])

    await handleNotificationInboxItemCreated(
      deps,
      event({
        payload: {
          inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
          organizationId: unbrand(NOTIF_TEST_IDS.orgId),
        },
      }),
    )

    expect(deps.fakes.jobs[0]!.data).toEqual(
      expect.objectContaining({
        type: 'feedback.created',
        propertyId: 'prop-from-item',
      }),
    )
  })

  it('marks a vanished inbox item obsolete instead of retrying it forever', async () => {
    const deps = makeDeps()
    deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue(null)

    await expect(handleNotificationInboxItemCreated(deps, event())).resolves.toEqual({
      status: 'obsolete',
    })

    expect(deps.fakes.jobs).toHaveLength(0)
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_ITEM_CREATED_CONSUMER,
      'obsolete',
    )
  })

  it('marks a source that can never notify obsolete, but a recipient-less org applied', async () => {
    const unknownSource = makeDeps()
    unknownSource.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: unbrand(NOTIF_TEST_IDS.propId),
      portalId: null,
      assignedTo: null,
      propertyName: null,
      guestRating: null,
      sourceType: 'goal',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    })
    await expect(
      handleNotificationInboxItemCreated(
        unknownSource,
        event({
          payload: {
            inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
            organizationId: unbrand(NOTIF_TEST_IDS.orgId),
          },
        }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    const noRecipients = makeDeps()
    noRecipients.fakes.responsibleManagers.findForProperty.mockResolvedValue([])
    noRecipients.fakes.userLookup.findByRole.mockResolvedValue([])
    await expect(
      handleNotificationInboxItemCreated(noRecipients, event()),
    ).resolves.toEqual({ status: 'applied' })
  })

  it('fails closed when the envelope organization does not match the payload', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationInboxItemCreated(deps, event({ organizationId: 'another-org' })),
    ).rejects.toThrow('attribution mismatch')

    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('writes no receipt when the enqueue fails, so the event is redelivered', async () => {
    const deps = makeDeps()
    deps.fakes.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(handleNotificationInboxItemCreated(deps, event())).rejects.toThrow(
      'Queue unavailable',
    )

    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
