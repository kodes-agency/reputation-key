import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  handleNotificationHandlingCycle,
  ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER,
  ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
  registerHandlingCycleNotificationConsumers,
} from './handling-cycle-outbox-consumers'
import type {
  HandlingCycleNotificationFacts,
  InboxItemFacts,
} from '../application/ports/inbox-item-lookup.port'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '93000000-0000-4000-8000-000000000001'
const ITEM = inboxItemId('93000000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('93000000-0000-4000-8000-000000000003')
const SOURCE = '93000000-0000-4000-8000-000000000004'
const PORTAL = '93000000-0000-4000-8000-000000000005'
const ORG = organizationId('organization-handling-cycle-notification')
const ACTOR = userId('actor-handling-cycle-notification')
const MANAGER = userId('manager-handling-cycle-notification')
const OWNER = userId('owner-handling-cycle-notification')
const ADMIN = userId('admin-handling-cycle-notification')
const OCCURRED_AT = '2026-08-27T10:00:00.000Z'

const event = (
  kind: 'opened' | 'reopened',
  payloadOverrides: Record<string, unknown> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: `inbox.handling_cycle.${kind}`,
  eventVersion: 1,
  payload: {
    inboxItemId: ITEM,
    cycleNumber: 2,
    stateRevision: 3,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId: SOURCE,
    sourceRevision: 2,
    actorType: kind === 'reopened' ? 'user' : 'provider',
    userId: kind === 'reopened' ? ACTOR : null,
    triggerEventId: 'trigger-handling-cycle-notification',
    ...(kind === 'opened'
      ? { openReason: 'material_revision_changed', source: 'import' }
      : { reopenReason: 'new_information', source: 'web' }),
    occurredAt: OCCURRED_AT,
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'inbox',
  sourceAggregateId: ITEM,
  occurredAt: OCCURRED_AT,
  recordedAt: OCCURRED_AT,
  ...envelopeOverrides,
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: unknown; opts?: unknown }> = []
  return {
    queue: {
      add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
        jobs.push({ name, data, opts })
      }),
    },
    userLookup: {
      findByRole: vi.fn(async () => [ADMIN]),
      getEmail: vi.fn(async () => null),
      getName: vi.fn(async () => null),
      findActorRole: vi.fn(async () => 'property_manager' as const),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [MANAGER, OWNER, ACTOR]),
      findForPortal: vi.fn(async () => [MANAGER, OWNER, ACTOR]),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    inboxItemLookup: {
      findInboxItemByReviewId: vi.fn(async () => ITEM),
      findInboxItemFacts: vi.fn(async (): Promise<InboxItemFacts | null> => ({
        propertyId: PROPERTY,
        portalId: null,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        guestRating: null,
        sourceType: 'review',
        createdAt: new Date('2026-08-27T08:00:00.000Z'),
      })),
      findHandlingCycleNotificationFacts: vi.fn(
        async (): Promise<HandlingCycleNotificationFacts | null> => ({
          propertyId: PROPERTY,
          portalId: null,
          assignedTo: null,
          propertyName: 'Riverside Hotel',
          guestRating: null,
          sourceType: 'review',
          sourceId: SOURCE,
          createdAt: new Date('2026-08-27T08:00:00.000Z'),
          currentCycleNumber: 2,
          currentSourceRevision: 2,
          stateRevision: 3,
          status: 'open',
        }),
      ),
      findResponseTargetReminderNotificationFacts: vi.fn(async () => null),
    },
    clock: () => new Date('2026-08-27T11:00:00.000Z'),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    jobs,
  }
}

describe('Handling Cycle notification durable consumers', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers opened and reopened facts under stable durable identities', () => {
    registerHandlingCycleNotificationConsumers(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toEqual([
      {
        eventType: 'inbox.handling_cycle.opened',
        consumerName: ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER,
      },
      {
        eventType: 'inbox.handling_cycle.reopened',
        consumerName: ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
      },
    ])
  })

  it('notifies current Property Responsible Managers about an exact material revision and suppresses the actor', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationHandlingCycle(
        deps,
        event('opened', { actorType: 'user', userId: ACTOR, source: 'web' }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      MANAGER,
      OWNER,
    ])
    expect(deps.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'insert-notification',
          data: expect.objectContaining({
            organizationId: ORG,
            propertyId: PROPERTY,
            type: 'review.updated',
            resourceType: 'inbox_item',
            resourceId: ITEM,
            eventId: EVENT_ID,
            payload: {
              propertyName: 'Riverside Hotel',
              platform: 'google',
              waitingHours: 3,
              actorRole: 'property_manager',
            },
            audience: {
              kind: 'handling_cycle',
              inboxItemId: ITEM,
              sourceType: 'review',
              sourceId: SOURCE,
              cycleNumber: 2,
              sourceRevision: 2,
              stateRevision: 3,
              actorUserId: ACTOR,
            },
          }),
          opts: { jobId: `${EVENT_ID}-${MANAGER}` },
        }),
      ]),
    )
    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledTimes(1)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
    expect(JSON.stringify(deps.jobs)).not.toMatch(
      /snippet|reviewer|guestText|comment|content|manualReopenExplanation/i,
    )
  })

  it('uses current Portal responsibility for private feedback and never all Property managers', async () => {
    const deps = makeDeps()
    deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      sourceId: SOURCE,
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 2,
      currentSourceRevision: 2,
      stateRevision: 3,
      status: 'open',
    })
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
    })

    await handleNotificationHandlingCycle(
      deps,
      event('reopened', { sourceType: 'feedback' }),
    )

    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect(deps.jobs.map((job) => (job.data as { type: string }).type)).toEqual([
      'inbox.reopened',
      'inbox.reopened',
    ])
  })

  it.each([
    ['initial review observation', { openReason: 'review_observed' }],
    ['initial feedback submission', { openReason: 'feedback_submitted' }],
    ['legacy backfill', { openReason: 'legacy_backfill' }],
  ])(
    'records %s without duplicating the item-created arrival notification',
    async (_label, change) => {
      const deps = makeDeps()

      await expect(
        handleNotificationHandlingCycle(deps, event('opened', change)),
      ).resolves.toEqual({ status: 'applied' })

      expect(
        deps.inboxItemLookup.findHandlingCycleNotificationFacts,
      ).not.toHaveBeenCalled()
      expect(deps.jobs).toEqual([])
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER,
        'applied',
      )
    },
  )

  it.each([
    ['missing head', null],
    ['later cycle', { currentCycleNumber: 3 }],
    ['later source revision', { currentSourceRevision: 3 }],
    ['later state revision', { stateRevision: 4 }],
    ['closed head', { status: 'closed' }],
    ['different Property', { propertyId: '93000000-0000-4000-8000-000000000099' }],
    ['different source', { sourceId: '93000000-0000-4000-8000-000000000098' }],
  ] as const)('marks a %s event obsolete without delivery', async (_label, change) => {
    const deps = makeDeps()
    if (change === null) {
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue(null)
    } else {
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
        propertyId: PROPERTY,
        portalId: null,
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        guestRating: null,
        sourceType: 'review',
        sourceId: SOURCE,
        createdAt: new Date('2026-08-27T08:00:00.000Z'),
        currentCycleNumber: 2,
        currentSourceRevision: 2,
        stateRevision: 3,
        status: 'open',
        ...change,
      })
    }

    await expect(
      handleNotificationHandlingCycle(deps, event('reopened')),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
      'obsolete',
    )
  })

  it('falls back to current AccountAdmins only when no eligible scoped manager exists', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([])

    await handleNotificationHandlingCycle(deps, event('reopened'))

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      ADMIN,
    ])
  })

  it('uses stable per-recipient jobs and leaves the event retryable after enqueue failure', async () => {
    const deps = makeDeps()
    await handleNotificationHandlingCycle(deps, event('reopened'))
    await handleNotificationHandlingCycle(deps, event('reopened'))
    expect(deps.jobs.map((job) => job.opts)).toEqual([
      { jobId: `${EVENT_ID}-${MANAGER}` },
      { jobId: `${EVENT_ID}-${OWNER}` },
      { jobId: `${EVENT_ID}-${MANAGER}` },
      { jobId: `${EVENT_ID}-${OWNER}` },
    ])

    deps.receipts.insertReceipt.mockClear()
    deps.queue.add.mockRejectedValue(new Error('queue unavailable'))
    await expect(
      handleNotificationHandlingCycle(deps, event('reopened')),
    ).rejects.toThrow('queue unavailable')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects envelope attribution drift before a current-state lookup', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationHandlingCycle(
        deps,
        event('reopened', {}, { organizationId: 'another-organization' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    await expect(
      handleNotificationHandlingCycle(deps, event('reopened', {}, { propertyId: null })),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.inboxItemLookup.findHandlingCycleNotificationFacts).not.toHaveBeenCalled()
  })
})
