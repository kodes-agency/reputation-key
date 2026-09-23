import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, userId } from '#/shared/domain/ids'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import {
  handleNotificationAssignmentsReleased,
  ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER,
  registerAssignmentReleaseNotificationConsumer,
} from './assignment-release-outbox-consumers'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'

let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '91000000-0000-4000-8000-000000000001'
const ORG = organizationId('org-assignment-release')
const PROPERTY_A = '91000000-0000-4000-8000-0000000000a1'
const PROPERTY_B = '91000000-0000-4000-8000-0000000000b1'
const ITEM_1 = '91000000-0000-4000-8000-000000000011'
const ITEM_2 = '91000000-0000-4000-8000-000000000012'
const ITEM_3 = '91000000-0000-4000-8000-000000000013'
const DEPARTING = userId('user-departing')
const ACTOR = userId('user-actor')
const MANAGER = userId('user-manager')

const event = (
  overrides: Partial<ConsumerEvent> = {},
  payload: Readonly<Record<string, unknown>> = {},
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.inbox_items.assignments_released',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    userId: ACTOR,
    releasedFrom: DEPARTING,
    releaseReason: 'member_offboarded',
    releases: [
      { inboxItemId: ITEM_1, propertyId: PROPERTY_A },
      { inboxItemId: ITEM_2, propertyId: PROPERTY_A },
      { inboxItemId: ITEM_3, propertyId: PROPERTY_B },
    ],
    count: 3,
    occurredAt: '2026-09-24T09:00:00.000Z',
    ...payload,
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'inbox',
  sourceAggregateId: ORG,
  recordedAt: '2026-09-24T09:00:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  fakes.responsibleManagers.findForProperty.mockResolvedValue([MANAGER])
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    fakes,
  }
}

const jobs = (deps: ReturnType<typeof makeDeps>) =>
  deps.fakes.jobs.map((job) => job.data as InsertNotificationJobData)

describe('an offboarding release tells whoever now owns the gap', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers under a stable identity', () => {
    registerAssignmentReleaseNotificationConsumer(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'inbox.inbox_items.assignments_released',
      consumerName: ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER,
    })
  })

  // One notice per Property, never one per item: a departing manager can leave
  // dozens of items behind and the point is that the work is now unowned.
  it('sends one grouped notice per Property, counting its items', async () => {
    const deps = makeDeps()

    await expect(handleNotificationAssignmentsReleased(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(jobs(deps)).toEqual([
      expect.objectContaining({
        userId: MANAGER,
        propertyId: PROPERTY_A,
        type: 'inbox.assignments_released',
        resourceType: 'inbox_item',
        resourceId: ITEM_1,
        payload: expect.objectContaining({ itemCount: 2 }),
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: PROPERTY_A },
        },
      }),
      expect.objectContaining({
        userId: MANAGER,
        propertyId: PROPERTY_B,
        payload: expect.objectContaining({ itemCount: 1 }),
      }),
    ])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER,
      'applied',
    )
  })

  it('never tells the departing member or the person who released them', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([
      DEPARTING,
      ACTOR,
      MANAGER,
    ])

    await handleNotificationAssignmentsReleased(deps, event())

    expect([...new Set(jobs(deps).map((job) => job.userId))]).toEqual([MANAGER])
  })

  it('writes its receipt even when the Property has nobody left to tell', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([DEPARTING])
    deps.userLookup.findByRole.mockResolvedValue([])

    await expect(handleNotificationAssignmentsReleased(deps, event())).resolves.toEqual({
      status: 'applied',
    })

    expect(jobs(deps)).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalled()
  })

  it('fails closed before fan-out or receipt on an Organization mismatch', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationAssignmentsReleased(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(jobs(deps)).toEqual([])
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
