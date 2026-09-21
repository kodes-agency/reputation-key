import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
  type ConsumerEvent,
} from '#/shared/outbox/consumer-registry'
import {
  handleWorkflowNotificationEvent,
  registerWorkflowNotificationConsumers,
  WORKFLOW_NOTIFICATION_CONSUMERS,
  type WorkflowNotificationConsumerDeps,
} from './workflow-outbox-consumers'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
  type FakeNotificationConsumerDeps,
} from './notification-consumer-test-fixtures'
import { unbrand } from '#/shared/domain/ids'
import { reviewReplyRejected } from '#/contexts/review/domain/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '30000000-0000-4000-8000-000000000008'

type Deps = WorkflowNotificationConsumerDeps & { fakes: FakeNotificationConsumerDeps }

const makeDeps = (): Deps => {
  const fakes = createNotificationConsumerDeps()
  fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
  fakes.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])
  fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
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

const event = (
  eventType: (typeof WORKFLOW_NOTIFICATION_CONSUMERS)[number]['eventType'],
  payload: Readonly<Record<string, unknown>>,
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType,
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
    ...payload,
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: eventType.split('.')[0]!,
  sourceAggregateId: 'aggregate-1',
  occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  recordedAt: NOTIF_TEST_IDS.now.toISOString(),
  correlationId: 'correlation-1',
  ...overrides,
})

describe('durable workflow notification consumers', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers every recorded beta workflow trigger under a stable identity', () => {
    registerWorkflowNotificationConsumers(consumerRegistry, makeDeps())

    expect(consumerRegistry.list()).toEqual(
      WORKFLOW_NOTIFICATION_CONSUMERS.map(({ eventType, consumerName }) => ({
        eventType,
        consumerName,
      })),
    )
  })

  it.each([
    {
      eventType: 'inbox.inbox_item.assigned' as const,
      payload: {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        assignedTo: unbrand(NOTIF_TEST_IDS.manager1),
        userId: unbrand(NOTIF_TEST_IDS.submitter),
        source: 'web',
      },
      notificationType: 'inbox.assigned',
    },
    {
      eventType: 'inbox.inbox_item.escalated' as const,
      payload: {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        userId: unbrand(NOTIF_TEST_IDS.submitter),
        source: 'web',
      },
      notificationType: 'inbox.escalated',
    },
    {
      eventType: 'inbox.inbox_note.added' as const,
      payload: {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        noteId: unbrand(NOTIF_TEST_IDS.noteId),
        userId: unbrand(NOTIF_TEST_IDS.authorId),
        source: 'web',
      },
      notificationType: 'inbox_note.added',
    },
    {
      eventType: 'review.reply.submitted' as const,
      payload: {
        replyId: unbrand(NOTIF_TEST_IDS.replyId),
        reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        userId: unbrand(NOTIF_TEST_IDS.submitter),
        source: 'web',
      },
      notificationType: 'reply.pending_approval',
    },
    ...(
      [
        ['review.reply.approved', 'reply.approved'],
        ['review.reply.rejected', 'reply.rejected'],
        ['review.reply.published', 'reply.published'],
        ['review.reply.publish_failed', 'reply.publish_failed'],
      ] as const
    ).map(([eventType, notificationType]) => ({
      eventType,
      payload: {
        replyId: unbrand(NOTIF_TEST_IDS.replyId),
        reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        userId: unbrand(NOTIF_TEST_IDS.submitter),
        authorId: unbrand(NOTIF_TEST_IDS.authorId),
        source: 'web',
      },
      notificationType,
    })),
  ])(
    'delivers $eventType through its durable route',
    async ({ eventType, payload, notificationType }) => {
      const deps = makeDeps()
      deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
        propertyId: NOTIF_TEST_IDS.propId,
        portalId: null,
        assignedTo: NOTIF_TEST_IDS.manager1,
        propertyName: 'Riverside Hotel',
        guestRating: null,
        sourceType: 'review',
        createdAt: new Date('2026-06-01T09:00:00.000Z'),
      })

      await expect(
        handleWorkflowNotificationEvent(deps, event(eventType, payload)),
      ).resolves.toEqual({ status: 'applied' })

      expect(deps.fakes.jobs).toHaveLength(1)
      expect(deps.fakes.jobs[0]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ type: notificationType, eventId: EVENT_ID }),
          opts: { jobId: expect.stringMatching(new RegExp(`^${EVENT_ID}-`)) },
        }),
      )
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        `notification.on-${eventType.replaceAll('.', '-')}`,
        'applied',
      )
    },
  )

  // The Google connection must be reconnected before any retry can publish;
  // the author has to hear that, not that Google rejected the reply.
  it('carries the reconnect cause of a failed publication to its author', async () => {
    const deps = makeDeps()
    const failure = (extra: Readonly<Record<string, unknown>>) =>
      event('review.reply.publish_failed', {
        replyId: unbrand(NOTIF_TEST_IDS.replyId),
        reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        authorId: unbrand(NOTIF_TEST_IDS.authorId),
        ...extra,
      })

    await handleWorkflowNotificationEvent(
      deps,
      failure({ cause: 'google_reauthorization_required' }),
    )
    await handleWorkflowNotificationEvent(deps, failure({}))

    expect(deps.fakes.jobs.map(({ data }) => data)).toEqual([
      expect.objectContaining({
        userId: unbrand(NOTIF_TEST_IDS.authorId),
        type: 'reply.publish_failed',
        payload: expect.objectContaining({
          publishFailureCause: 'google_reauthorization_required',
        }),
      }),
      expect.objectContaining({
        type: 'reply.publish_failed',
        payload: expect.not.objectContaining({ publishFailureCause: expect.anything() }),
      }),
    ])
  })

  it('uses the same per-recipient job identity after an ambiguous replay', async () => {
    const deps = makeDeps()
    const approval = event('review.reply.approved', {
      replyId: unbrand(NOTIF_TEST_IDS.replyId),
      reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
      userId: unbrand(NOTIF_TEST_IDS.submitter),
      authorId: unbrand(NOTIF_TEST_IDS.authorId),
      source: 'web',
    })

    await handleWorkflowNotificationEvent(deps, approval)
    await handleWorkflowNotificationEvent(deps, approval)

    expect(deps.fakes.jobs.map(({ opts }) => opts)).toEqual([
      { jobId: `${EVENT_ID}-${unbrand(NOTIF_TEST_IDS.authorId)}` },
      { jobId: `${EVENT_ID}-${unbrand(NOTIF_TEST_IDS.authorId)}` },
    ])
  })

  it('preserves bulkId and lets the grouped completion fact own delivery', async () => {
    const deps = makeDeps()

    await expect(
      handleWorkflowNotificationEvent(
        deps,
        event('inbox.inbox_item.assigned', {
          inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
          assignedTo: unbrand(NOTIF_TEST_IDS.manager1),
          userId: unbrand(NOTIF_TEST_IDS.submitter),
          bulkId: '30000000-0000-4000-8000-000000000099',
          source: 'web',
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs).toEqual([])
    expect(deps.fakes.inboxItemLookup.findInboxItemFacts).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      'notification.on-inbox-inbox_item-assigned',
      'applied',
    )
  })

  describe('never tells a person about their own action', () => {
    const recipientsOf = (deps: Deps) =>
      deps.fakes.jobs.map((job) => (job.data as { userId: string }).userId)

    it('skips the notice when a manager assigns the item to themselves', async () => {
      const deps = makeDeps()

      await expect(
        handleWorkflowNotificationEvent(
          deps,
          event('inbox.inbox_item.assigned', {
            inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
            assignedTo: unbrand(NOTIF_TEST_IDS.manager1),
            userId: unbrand(NOTIF_TEST_IDS.manager1),
            source: 'web',
          }),
        ),
      ).resolves.toEqual({ status: 'applied' })

      expect(deps.fakes.jobs).toEqual([])
      expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        'notification.on-inbox-inbox_item-assigned',
        'applied',
      )
    })

    it.each([
      {
        eventType: 'inbox.inbox_item.escalated' as const,
        payload: { inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId) },
      },
      {
        eventType: 'review.reply.submitted' as const,
        payload: {
          replyId: unbrand(NOTIF_TEST_IDS.replyId),
          reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        },
      },
    ])(
      'tells the other AccountAdmins, not the admin who acted, about $eventType',
      async ({ eventType, payload }) => {
        const deps = makeDeps()
        deps.fakes.userLookup.findByRole.mockResolvedValue([
          NOTIF_TEST_IDS.admin1,
          NOTIF_TEST_IDS.admin2,
        ])

        await handleWorkflowNotificationEvent(
          deps,
          event(eventType, {
            ...payload,
            userId: unbrand(NOTIF_TEST_IDS.admin1),
            source: 'web',
          }),
        )

        expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.admin2])
      },
    )

    it.each(['review.reply.approved', 'review.reply.rejected'] as const)(
      'skips the author notice when the author decided %s on their own reply',
      async (eventType) => {
        const deps = makeDeps()

        await expect(
          handleWorkflowNotificationEvent(
            deps,
            event(eventType, {
              replyId: unbrand(NOTIF_TEST_IDS.replyId),
              reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
              userId: unbrand(NOTIF_TEST_IDS.authorId),
              authorId: unbrand(NOTIF_TEST_IDS.authorId),
              source: 'web',
            }),
          ),
        ).resolves.toEqual({ status: 'applied' })

        expect(deps.fakes.jobs).toEqual([])
      },
    )
  })

  describe('a reply that failed to publish', () => {
    const publishFailed = (authorId: string | null) =>
      event('review.reply.publish_failed', {
        replyId: unbrand(NOTIF_TEST_IDS.replyId),
        reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        authorId,
      })

    it('goes to the author while they can still act on the Property', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(
        deps,
        publishFailed(unbrand(NOTIF_TEST_IDS.authorId)),
      )

      expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
        expect.objectContaining({
          userId: NOTIF_TEST_IDS.authorId,
          type: 'reply.publish_failed',
          audience: { kind: 'property_operator' },
        }),
      ])
    })

    it.each([
      ['has left the Property', unbrand(NOTIF_TEST_IDS.authorId)],
      ['is unknown', null],
    ])(
      'goes to the Property responsible managers when the author %s',
      async (_label, authorId) => {
        const deps = makeDeps()
        deps.fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)

        await handleWorkflowNotificationEvent(deps, publishFailed(authorId))

        expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
          expect.objectContaining({
            userId: NOTIF_TEST_IDS.manager1,
            type: 'reply.publish_failed',
            audience: {
              kind: 'responsible_scope',
              scope: { kind: 'property', propertyId: NOTIF_TEST_IDS.propId },
            },
          }),
        ])
      },
    )
  })

  describe('a rejected reply recorded through the outbox', () => {
    const recordRejection = (reason: string | null): ConsumerEvent => {
      const fact = reviewReplyRejected({
        replyId: NOTIF_TEST_IDS.replyId,
        reviewId: NOTIF_TEST_IDS.reviewId,
        propertyId: NOTIF_TEST_IDS.propId,
        organizationId: NOTIF_TEST_IDS.orgId,
        userId: NOTIF_TEST_IDS.admin1,
        authorId: NOTIF_TEST_IDS.authorId,
        reason,
        occurredAt: NOTIF_TEST_IDS.now,
      })
      const row = toOutboxEvent(fact)
      return buildConsumerEvent({
        id: fact.eventId,
        eventType: row.eventType,
        eventVersion: row.eventVersion ?? 1,
        payload: row.payload,
        organizationId: row.organizationId,
        propertyId: row.propertyId ?? null,
        sourceContext: row.sourceContext,
        sourceAggregateId: row.sourceAggregateId,
        recordedAt: NOTIF_TEST_IDS.now,
      })
    }

    const deliverRejection = async (reason: string | null) => {
      const deps = makeDeps()
      const recorded = recordRejection(reason)
      await handleWorkflowNotificationEvent(deps, recorded)
      const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
      const { body } = renderNotification(
        'reply.rejected',
        parseNotificationPayload(data.payload),
      )
      return { recorded, data, body }
    }

    it('tells the author a reason is waiting without carrying its words', async () => {
      const { recorded, data, body } = await deliverRejection(
        'Too defensive, drop the refund mention',
      )

      expect(body).toBe(
        'The approver left a reason. Open the reply to read it, then edit and resubmit.',
      )
      expect(JSON.stringify([recorded, data])).not.toContain('refund')
    })

    it('says there was no reason only when the approver gave none', async () => {
      const { data, body } = await deliverRejection(null)

      // Explicit, so a later reasonless rejection that coalesces into an
      // unread row replaces "a reason is waiting" (newest wins per key).
      expect(data.payload).toMatchObject({ hasModerationReason: false })
      expect(body).toBe('It was sent back without a reason. Edit it and resubmit.')
    })
  })

  it.each([
    {
      eventType: 'inbox.inbox_item.escalated' as const,
      payload: {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        userId: null,
        source: 'import',
      },
    },
    {
      eventType: 'inbox.inbox_note.added' as const,
      payload: {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        noteId: unbrand(NOTIF_TEST_IDS.noteId),
        userId: null,
        source: 'import',
      },
    },
  ])(
    'accepts the domain-valid system actor for $eventType',
    async ({ eventType, payload }) => {
      const deps = makeDeps()

      await expect(
        handleWorkflowNotificationEvent(deps, event(eventType, payload)),
      ).resolves.toEqual({ status: 'applied' })
      expect(deps.fakes.jobs).toHaveLength(1)
    },
  )

  it('rejects cross-organization attribution before enqueue or receipt', async () => {
    const deps = makeDeps()
    const approval = event(
      'review.reply.approved',
      {
        replyId: unbrand(NOTIF_TEST_IDS.replyId),
        reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        userId: unbrand(NOTIF_TEST_IDS.submitter),
        authorId: unbrand(NOTIF_TEST_IDS.authorId),
        source: 'web',
      },
      { organizationId: 'another-organization' },
    )

    await expect(handleWorkflowNotificationEvent(deps, approval)).rejects.toThrow(
      'attribution mismatch',
    )
    expect(deps.fakes.jobs).toHaveLength(0)
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects a payload that drops the envelope property attribution', async () => {
    const deps = makeDeps()

    await expect(
      handleWorkflowNotificationEvent(
        deps,
        event('inbox.inbox_item.escalated', {
          inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
          propertyId: null,
          userId: null,
          source: 'import',
        }),
      ),
    ).rejects.toThrow('attribution mismatch')

    expect(deps.fakes.jobs).toHaveLength(0)
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })

  it('does not acknowledge an event when enqueue fails', async () => {
    const deps = makeDeps()
    deps.fakes.addMock.mockRejectedValue(new Error('Queue unavailable'))

    await expect(
      handleWorkflowNotificationEvent(
        deps,
        event('review.reply.approved', {
          replyId: unbrand(NOTIF_TEST_IDS.replyId),
          reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
          userId: unbrand(NOTIF_TEST_IDS.submitter),
          authorId: unbrand(NOTIF_TEST_IDS.authorId),
          source: 'web',
        }),
      ),
    ).rejects.toThrow('Queue unavailable')

    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
