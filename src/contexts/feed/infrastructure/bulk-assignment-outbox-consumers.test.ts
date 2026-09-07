import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import {
  handleNotificationBulkAssignmentCompleted,
  ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER,
  registerBulkAssignmentNotificationConsumer,
} from './bulk-assignment-outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '90000000-0000-4000-8000-000000000001'
const ORG = '90000000-0000-4000-8000-000000000002'
const ACTOR = 'better-auth_actor-03'
const ASSIGNEE = 'better-auth_assignee-04'
const BULK = '90000000-0000-4000-8000-000000000005'
const PROPERTY_A = '90000000-0000-4000-8000-000000000006'
const PROPERTY_B = '90000000-0000-4000-8000-000000000007'
const ITEM_A1 = '90000000-0000-4000-8000-000000000008'
const ITEM_A2 = '90000000-0000-4000-8000-000000000009'
const ITEM_B = '90000000-0000-4000-8000-000000000010'

const transitions = [
  {
    inboxItemId: ITEM_A1,
    propertyId: PROPERTY_A,
    previousAssignee: null,
    nextAssignee: ASSIGNEE,
  },
  {
    inboxItemId: ITEM_A2,
    propertyId: PROPERTY_A,
    previousAssignee: null,
    nextAssignee: ASSIGNEE,
  },
  {
    inboxItemId: ITEM_B,
    propertyId: PROPERTY_B,
    previousAssignee: null,
    nextAssignee: ASSIGNEE,
  },
] as const

const event = (payloadOverrides: Record<string, unknown> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.inbox_items.bulk_assignment_completed',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    userId: ACTOR,
    bulkId: BULK,
    transitions,
    count: transitions.length,
    source: 'web',
    occurredAt: '2026-08-27T12:00:00.000Z',
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'inbox',
  sourceAggregateId: BULK,
  recordedAt: '2026-08-27T12:00:00.000Z',
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

describe('bulk-assignment notification durable consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers the completion fact as the sole grouped replay boundary', () => {
    registerBulkAssignmentNotificationConsumer(consumerRegistry, makeDeps())
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'inbox.inbox_items.bulk_assignment_completed',
      consumerName: ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER,
    })
  })

  it('partitions by Property and carries exact current-assignee audiences', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationBulkAssignmentCompleted(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs).toHaveLength(2)
    expect(deps.fakes.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            userId: ASSIGNEE,
            propertyId: PROPERTY_A,
            type: 'inbox.bulk_assigned',
            resourceId: ITEM_A1,
            payload: { itemCount: 2, actorRole: 'property_manager' },
            audience: {
              kind: 'bulk_inbox_assignee',
              inboxItemIds: [ITEM_A1, ITEM_A2],
            },
          }),
          opts: { jobId: `${EVENT_ID}-${ASSIGNEE}-${PROPERTY_A}` },
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            propertyId: PROPERTY_B,
            resourceId: ITEM_B,
            payload: { itemCount: 1, actorRole: 'property_manager' },
            audience: {
              kind: 'bulk_inbox_assignee',
              inboxItemIds: [ITEM_B],
            },
          }),
          opts: { jobId: `${EVENT_ID}-${ASSIGNEE}-${PROPERTY_B}` },
        }),
      ]),
    )
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER,
      'applied',
    )
  })

  it('uses identical queue identities on ambiguous replay', async () => {
    const deps = makeDeps()
    await handleNotificationBulkAssignmentCompleted(deps, event())
    await handleNotificationBulkAssignmentCompleted(deps, event())

    expect(deps.fakes.jobs.map((job) => job.opts)).toEqual([
      { jobId: `${EVENT_ID}-${ASSIGNEE}-${PROPERTY_A}` },
      { jobId: `${EVENT_ID}-${ASSIGNEE}-${PROPERTY_B}` },
      { jobId: `${EVENT_ID}-${ASSIGNEE}-${PROPERTY_A}` },
      { jobId: `${EVENT_ID}-${ASSIGNEE}-${PROPERTY_B}` },
    ])
  })

  it('does not acknowledge an ambiguous enqueue failure', async () => {
    const deps = makeDeps()
    deps.fakes.addMock.mockRejectedValueOnce(new Error('Queue unavailable'))

    await expect(
      handleNotificationBulkAssignmentCompleted(deps, event()),
    ).rejects.toThrow('Queue unavailable')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('records a release without notifying an actor or fallback recipient', async () => {
    const deps = makeDeps()
    const released = transitions.map((transition) => ({
      ...transition,
      previousAssignee: ASSIGNEE,
      nextAssignee: null,
    }))

    await handleNotificationBulkAssignmentCompleted(
      deps,
      event({ transitions: released }),
    )

    expect(deps.fakes.jobs).toEqual([])
    expect(deps.fakes.userLookup.findActorRole).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledTimes(1)
  })

  it('rejects non-canonical or mixed-target completion facts before enqueue', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationBulkAssignmentCompleted(
        deps,
        event({ transitions: [...transitions].reverse() }),
      ),
    ).rejects.toThrow('not canonical')
    await expect(
      handleNotificationBulkAssignmentCompleted(
        deps,
        event({
          transitions: [
            transitions[0],
            { ...transitions[1], nextAssignee: ACTOR },
            transitions[2],
          ],
        }),
      ),
    ).rejects.toThrow('multiple target assignees')
    expect(deps.fakes.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects unsafe opaque actor or assignee identifiers before enqueue', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationBulkAssignmentCompleted(
        deps,
        event({ userId: 'actor with spaces' }),
      ),
    ).rejects.toThrow('contract is invalid')
    await expect(
      handleNotificationBulkAssignmentCompleted(
        deps,
        event({
          transitions: transitions.map((transition) => ({
            ...transition,
            nextAssignee: 'assignee\nnewline',
          })),
        }),
      ),
    ).rejects.toThrow('canonical identifiers')

    expect(deps.fakes.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
