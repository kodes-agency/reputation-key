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
  handleNotificationBulkReopenCompleted,
  handleNotificationHandlingCycle,
  ON_INBOX_BULK_REOPEN_COMPLETED_CONSUMER,
  ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER,
  ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
  registerHandlingCycleNotificationConsumers,
} from './handling-cycle-outbox-consumers'
import type {
  HandlingCycleNotificationFacts,
  InboxItemFacts,
  InboxItemLookupPort,
} from '../application/ports/notification-inbox-item-lookup.port'

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
const ASSIGNEE = userId('assignee-handling-cycle-notification')
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
      isHistoricalOnboardingItem: vi.fn(async () => false),
      findHandlingCycleNotificationFacts: vi.fn<
        InboxItemLookupPort['findHandlingCycleNotificationFacts']
      >(async () => ({
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
      })),
      findResponseTargetReminderNotificationFacts: vi.fn(async () => null),
      findWaitingSince: vi.fn(async (): Promise<Date | null> => null),
      findNoteAuthors: vi.fn(async () => []),
      countOpenReviewItemsForProperty: vi.fn(async () => 0),
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

  it('registers opened, reopened and bulk-reopen facts under stable durable identities', () => {
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
      {
        eventType: 'inbox.inbox_items.bulk_reopen_completed',
        consumerName: ON_INBOX_BULK_REOPEN_COMPLETED_CONSUMER,
      },
    ])
  })

  it('leaves a reopen that a bulk command covers to its completion fact', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationHandlingCycle(
        deps,
        event('reopened', { bulkId: '93000000-0000-4000-8000-0000000000b1' }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs).toEqual([])
    expect(deps.inboxItemLookup.findHandlingCycleNotificationFacts).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
      'applied',
    )
  })

  describe('a bulk reopen', () => {
    const BULK = '93000000-0000-4000-8000-0000000000b1'
    const SECOND_ITEM = inboxItemId('93000000-0000-4000-8000-000000000012')
    const THIRD_ITEM = inboxItemId('93000000-0000-4000-8000-000000000013')
    const OTHER_PROPERTY = propertyId('93000000-0000-4000-8000-000000000033')

    type Cycle = Readonly<{
      inboxItemId: string
      propertyId: string
      sourceType: 'review' | 'feedback'
      sourceId: string
      cycleNumber: number
      sourceRevision: number
      stateRevision: number
    }>

    const reopenedCycle = (item: string, overrides: Partial<Cycle> = {}): Cycle => ({
      inboxItemId: item,
      propertyId: PROPERTY,
      sourceType: 'review',
      sourceId: `${item.slice(0, -3)}9${item.slice(-2)}`,
      cycleNumber: 2,
      sourceRevision: 2,
      stateRevision: 3,
      ...overrides,
    })

    const completion = (reopened: ReadonlyArray<Cycle>): ConsumerEvent => ({
      eventId: EVENT_ID,
      eventType: 'inbox.inbox_items.bulk_reopen_completed',
      eventVersion: 1,
      payload: {
        organizationId: ORG,
        userId: ACTOR,
        bulkId: BULK,
        reopened,
        count: reopened.length,
        source: 'web',
        occurredAt: OCCURRED_AT,
      },
      organizationId: ORG,
      propertyId: null,
      sourceContext: 'inbox',
      sourceAggregateId: ACTOR,
      occurredAt: OCCURRED_AT,
      recordedAt: OCCURRED_AT,
    })

    /** Each reopened cycle is still the item's exact open head unless changed. */
    const withHeads = (
      deps: ReturnType<typeof makeDeps>,
      cycles: ReadonlyArray<Cycle>,
      changes: Readonly<Record<string, Partial<HandlingCycleNotificationFacts>>> = {},
    ) => {
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockImplementation(
        async (item) => {
          const cycle = cycles.find((candidate) => candidate.inboxItemId === item)
          if (!cycle) return null
          return {
            propertyId: cycle.propertyId,
            portalId: cycle.sourceType === 'feedback' ? PORTAL : null,
            assignedTo: null,
            propertyName:
              cycle.propertyId === PROPERTY ? 'Riverside Hotel' : 'Harbour Inn',
            guestRating: null,
            sourceType: cycle.sourceType,
            sourceId: cycle.sourceId,
            createdAt: new Date('2026-08-27T08:00:00.000Z'),
            currentCycleNumber: cycle.cycleNumber,
            currentSourceRevision: cycle.sourceRevision,
            stateRevision: cycle.stateRevision,
            status: 'open',
            ...changes[item],
          }
        },
      )
      return deps
    }

    const delivered = (deps: ReturnType<typeof makeDeps>) =>
      deps.jobs.map((job) => {
        const data = job.data as {
          userId: string
          propertyId: string
          type: string
          resourceId: string
          payload: unknown
          audience: { cycles: ReadonlyArray<{ inboxItemId: string }> }
        }
        return {
          userId: data.userId,
          propertyId: data.propertyId,
          type: data.type,
          resourceId: data.resourceId,
          payload: data.payload,
          items: data.audience.cycles.map((cycle) => cycle.inboxItemId),
          jobId: (job.opts as { jobId: string }).jobId,
        }
      })

    it('sends one notice per recipient and Property instead of one per item', async () => {
      const cycles = [
        reopenedCycle(ITEM),
        reopenedCycle(SECOND_ITEM),
        reopenedCycle(THIRD_ITEM, { propertyId: OTHER_PROPERTY }),
      ]
      const deps = withHeads(makeDeps(), cycles)

      await expect(
        handleNotificationBulkReopenCompleted(deps, completion(cycles)),
      ).resolves.toEqual({ status: 'applied' })

      const grouped = (recipient: string, property: string, items: string[]) => ({
        userId: recipient,
        propertyId: property,
        type: 'inbox.bulk_reopened',
        resourceId: items[0],
        payload: {
          propertyName: property === PROPERTY ? 'Riverside Hotel' : 'Harbour Inn',
          itemCount: items.length,
          actorRole: 'property_manager',
        },
        items,
        jobId: `${EVENT_ID}-${recipient}-${property}`,
      })
      // The actor is responsible too, and is told nothing.
      expect(delivered(deps)).toEqual(
        expect.arrayContaining([
          grouped(MANAGER, PROPERTY, [ITEM, SECOND_ITEM]),
          grouped(OWNER, PROPERTY, [ITEM, SECOND_ITEM]),
          grouped(MANAGER, OTHER_PROPERTY, [THIRD_ITEM]),
          grouped(OWNER, OTHER_PROPERTY, [THIRD_ITEM]),
        ]),
      )
      expect(deps.jobs).toHaveLength(4)
      expect(deps.jobs[0]!.data).toMatchObject({
        audience: {
          kind: 'bulk_handling_cycle',
          cycles: [
            expect.objectContaining({ inboxItemId: ITEM, stateRevision: 3 }),
            expect.objectContaining({ inboxItemId: SECOND_ITEM, stateRevision: 3 }),
          ],
          actorUserId: ACTOR,
        },
      })
    })

    it('counts for each recipient only the items they are responsible for', async () => {
      const cycles = [
        reopenedCycle(ITEM),
        reopenedCycle(SECOND_ITEM, { sourceType: 'feedback' }),
      ]
      const deps = withHeads(makeDeps(), cycles)
      deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER])
      deps.responsibleManagers.findForPortal.mockResolvedValue([OWNER, MANAGER])

      await handleNotificationBulkReopenCompleted(deps, completion(cycles))

      expect(
        delivered(deps).map(({ userId: recipient, items }) => ({ recipient, items })),
      ).toEqual(
        expect.arrayContaining([
          { recipient: MANAGER, items: [ITEM, SECOND_ITEM] },
          { recipient: OWNER, items: [SECOND_ITEM] },
        ]),
      )
      expect(deps.jobs).toHaveLength(2)
    })

    it('leaves out a cycle that has moved on, and is obsolete when none is left', async () => {
      const cycles = [reopenedCycle(ITEM), reopenedCycle(SECOND_ITEM)]
      const deps = withHeads(makeDeps(), cycles, { [SECOND_ITEM]: { status: 'closed' } })

      await handleNotificationBulkReopenCompleted(deps, completion(cycles))
      expect(delivered(deps).map(({ items }) => items)).toEqual([[ITEM], [ITEM]])

      const stale = withHeads(makeDeps(), cycles, {
        [ITEM]: { stateRevision: 4 },
        [SECOND_ITEM]: { currentCycleNumber: 3 },
      })
      await expect(
        handleNotificationBulkReopenCompleted(stale, completion(cycles)),
      ).resolves.toEqual({ status: 'obsolete' })
      expect(stale.jobs).toEqual([])
      expect(stale.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        ON_INBOX_BULK_REOPEN_COMPLETED_CONSUMER,
        'obsolete',
      )
    })

    it('converges on the same jobs after a replay and stays retryable after a failed enqueue', async () => {
      const cycles = [reopenedCycle(ITEM)]
      const deps = withHeads(makeDeps(), cycles)

      await handleNotificationBulkReopenCompleted(deps, completion(cycles))
      await handleNotificationBulkReopenCompleted(deps, completion(cycles))
      expect(deps.jobs.map((job) => job.opts)).toEqual([
        { jobId: `${EVENT_ID}-${MANAGER}-${PROPERTY}` },
        { jobId: `${EVENT_ID}-${OWNER}-${PROPERTY}` },
        { jobId: `${EVENT_ID}-${MANAGER}-${PROPERTY}` },
        { jobId: `${EVENT_ID}-${OWNER}-${PROPERTY}` },
      ])

      deps.receipts.insertReceipt.mockClear()
      deps.queue.add.mockRejectedValue(new Error('queue unavailable'))
      await expect(
        handleNotificationBulkReopenCompleted(deps, completion(cycles)),
      ).rejects.toThrow('queue unavailable')
      expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
    })

    it('rejects a completion fact attributed to another Organization', async () => {
      const deps = makeDeps()

      await expect(
        handleNotificationBulkReopenCompleted(deps, {
          ...completion([reopenedCycle(ITEM)]),
          organizationId: 'another-organization',
        }),
      ).rejects.toThrow('attribution mismatch')
      expect(deps.jobs).toEqual([])
    })
  })

  it('carries the reopen cause into the notice, and never its free-text explanation', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationHandlingCycle(
        deps,
        event('reopened', {
          reopenReason: 'provider_reply_deleted',
          manualReopenExplanation: 'Google dropped our reply again, see thread',
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    const payloads = deps.jobs.map((job) => (job.data as { payload: unknown }).payload)
    expect(payloads.length).toBeGreaterThan(0)
    for (const payload of payloads) {
      expect(payload).toMatchObject({ reopenReason: 'provider_reply_deleted' })
    }
    expect(JSON.stringify(deps.jobs)).not.toContain('Google dropped our reply again')
  })

  it('leaves a reopen cause off a notice that is not about a reopen', async () => {
    const deps = makeDeps()

    await handleNotificationHandlingCycle(deps, event('opened'))

    for (const job of deps.jobs) {
      expect(
        (job.data as { payload: Record<string, unknown> }).payload,
      ).not.toHaveProperty('reopenReason')
    }
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
            // A revision opens a new wait; it has not waited yet, so the
            // notice carries no age at all.
            payload: {
              propertyName: 'Riverside Hotel',
              platform: 'google',
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
    // Inbox caught up while creating the item: nobody saw the older revision,
    // so "New review" is the whole story and "Review updated" would be noise.
    [
      'revision the item was created with',
      { openReason: 'material_revision_changed', openedWithItem: true },
    ],
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

  // I15: a non-responsible PM drafting a reply was never told the review had
  // changed or the follow-up had reopened, although `target_passed` already
  // includes the eligible assignee for exactly that reason.
  describe('the person actually working on the item', () => {
    const assignedTo = (deps: ReturnType<typeof makeDeps>, assignee: string | null) =>
      deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
        propertyId: PROPERTY,
        portalId: null,
        assignedTo: assignee as never,
        propertyName: 'Riverside Hotel',
        guestRating: null,
        sourceType: 'review',
        sourceId: SOURCE,
        createdAt: new Date('2026-08-27T08:00:00.000Z'),
        currentCycleNumber: 2,
        currentSourceRevision: 2,
        stateRevision: 3,
        status: 'open',
      })

    it.each(['opened', 'reopened'] as const)(
      'tells the eligible assignee about a %s cycle, beside the responsible scope',
      async (kind) => {
        const deps = makeDeps()
        assignedTo(deps, ASSIGNEE)
        deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER])

        await handleNotificationHandlingCycle(deps, event(kind))

        expect(
          deps.jobs.map((job) => (job.data as { userId: string }).userId).sort(),
        ).toEqual([ASSIGNEE, MANAGER].sort())
      },
    )

    it('leaves out an assignee who is no longer eligible for the Property', async () => {
      const deps = makeDeps()
      assignedTo(deps, ASSIGNEE)
      deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER])
      deps.responsibleManagers.isEligibleForProperty.mockImplementation(
        async (...args: unknown[]) => args[2] !== ASSIGNEE,
      )

      await handleNotificationHandlingCycle(deps, event('reopened'))

      expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
        MANAGER,
      ])
    })

    it('never tells the assignee who reopened it themselves', async () => {
      const deps = makeDeps()
      assignedTo(deps, ACTOR)
      deps.responsibleManagers.findForProperty.mockResolvedValue([MANAGER])

      await handleNotificationHandlingCycle(deps, event('reopened'))

      expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
        MANAGER,
      ])
    })
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
