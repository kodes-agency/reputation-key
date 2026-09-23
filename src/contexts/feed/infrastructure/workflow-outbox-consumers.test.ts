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
import {
  reviewReplyPublishFailed,
  reviewReplyRejected,
} from '#/contexts/review/domain/events'
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
    replyApproval: fakes.replyApproval,
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

const recipientsOf = (deps: Deps) =>
  deps.fakes.jobs.map((job) => (job.data as { userId: string }).userId)

const audienceOf = (deps: Deps) =>
  (deps.fakes.jobs[0]!.data as InsertNotificationJobData).audience

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
        // The AccountAdmin fallback: the Property has no responsible manager
        // who could take either notice, so both fall through to the admins.
        deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([])
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

  // I5.3: an approval request used to go to every AccountAdmin in the
  // Organization, while the Property's responsible managers — who hold
  // reply.manage and could approve — were never asked.
  describe('who is asked to approve a reply', () => {
    const submitted = (submitterId: string) =>
      event('review.reply.submitted', {
        replyId: unbrand(NOTIF_TEST_IDS.replyId),
        reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
        userId: submitterId,
        source: 'web',
      })

    it('asks the responsible managers who may approve, not every admin', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
        NOTIF_TEST_IDS.manager1,
        NOTIF_TEST_IDS.manager2,
      ])
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

      await handleWorkflowNotificationEvent(deps, submitted(NOTIF_TEST_IDS.submitter))

      expect(recipientsOf(deps)).toEqual([
        NOTIF_TEST_IDS.manager1,
        NOTIF_TEST_IDS.manager2,
      ])
      expect(audienceOf(deps)).toEqual({
        kind: 'reply_approver',
        propertyId: unbrand(NOTIF_TEST_IDS.propId),
      })
    })

    it('leaves out a responsible manager who may not approve replies', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
        NOTIF_TEST_IDS.manager1,
        NOTIF_TEST_IDS.manager2,
      ])
      deps.fakes.replyApproval.canApproveReplies.mockImplementation(
        async (_org: string, _property: string, candidate: string) =>
          candidate === NOTIF_TEST_IDS.manager2,
      )

      await handleWorkflowNotificationEvent(deps, submitted(NOTIF_TEST_IDS.submitter))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.manager2])
    })

    it('falls back to the AccountAdmins when no responsible manager may approve', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
        NOTIF_TEST_IDS.manager1,
      ])
      deps.fakes.replyApproval.canApproveReplies.mockResolvedValue(false)
      deps.fakes.userLookup.findByRole.mockResolvedValue([
        NOTIF_TEST_IDS.admin1,
        NOTIF_TEST_IDS.admin2,
      ])

      await handleWorkflowNotificationEvent(deps, submitted(NOTIF_TEST_IDS.submitter))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.admin1, NOTIF_TEST_IDS.admin2])
      expect(audienceOf(deps)).toEqual({ kind: 'account_admin' })
    })

    it('never asks the submitter, even when they are the only approver', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
        NOTIF_TEST_IDS.manager1,
      ])
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

      await handleWorkflowNotificationEvent(deps, submitted(NOTIF_TEST_IDS.manager1))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.admin1])
    })
  })

  // The same rule for escalations: the Property's or Portal's responsible
  // scope first, AccountAdmins only when it has nobody.
  describe('who hears that an item was escalated', () => {
    const escalated = (actorId: string) =>
      event('inbox.inbox_item.escalated', {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        userId: actorId,
        source: 'web',
      })

    it('tells the Property responsible managers rather than every admin', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
        NOTIF_TEST_IDS.manager1,
      ])
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

      await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.submitter))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.manager1])
      expect(audienceOf(deps)).toEqual({
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: unbrand(NOTIF_TEST_IDS.propId) },
      })
    })

    it('tells the Portal responsible managers when the item is private feedback', async () => {
      const deps = makeDeps()
      deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
        propertyId: unbrand(NOTIF_TEST_IDS.propId),
        portalId: 'portal-1',
        assignedTo: null,
        propertyName: 'Riverside Hotel',
        guestRating: null,
        sourceType: 'feedback',
        createdAt: NOTIF_TEST_IDS.now,
      })
      deps.fakes.responsibleManagers.findForPortal.mockResolvedValue([
        NOTIF_TEST_IDS.manager2,
      ])

      await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.submitter))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.manager2])
    })

    it('falls back to the AccountAdmins when the scope has nobody', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([])
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

      await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.submitter))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.admin1])
    })

    it('never tells whoever escalated it', async () => {
      const deps = makeDeps()
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
        NOTIF_TEST_IDS.manager1,
        NOTIF_TEST_IDS.manager2,
      ])

      await handleWorkflowNotificationEvent(deps, escalated(NOTIF_TEST_IDS.manager1))

      expect(recipientsOf(deps)).toEqual([NOTIF_TEST_IDS.manager2])
    })
  })

  it('names the role of whoever escalated, since escalation is always a manual call', async () => {
    const deps = makeDeps()

    await handleWorkflowNotificationEvent(
      deps,
      event('inbox.inbox_item.escalated', {
        inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
        userId: unbrand(NOTIF_TEST_IDS.submitter),
        source: 'web',
      }),
    )

    const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
    expect(deps.fakes.userLookup.findActorRole).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.submitter,
      NOTIF_TEST_IDS.orgId,
    )
    expect(data.payload).toMatchObject({ actorRole: 'property_manager' })
    expect(
      renderNotification('inbox.escalated', parseNotificationPayload(data.payload)).body,
    ).toMatch(/^A property manager escalated this/)
  })

  describe('how long something has waited', () => {
    const WAIT_STARTED = new Date('2026-06-01T07:00:00.000Z')

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
      "stamps $eventType with when the current wait began, not the item's age",
      async ({ eventType, payload }) => {
        const deps = makeDeps()
        deps.fakes.inboxItemLookup.findWaitingSince.mockResolvedValue(WAIT_STARTED)

        await handleWorkflowNotificationEvent(
          deps,
          event(eventType, { ...payload, userId: unbrand(NOTIF_TEST_IDS.submitter) }),
        )

        const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
        expect(deps.fakes.inboxItemLookup.findWaitingSince).toHaveBeenCalledWith(
          NOTIF_TEST_IDS.inboxItemId,
          NOTIF_TEST_IDS.orgId,
        )
        expect(data.payload).toMatchObject({ waitingSince: WAIT_STARTED.toISOString() })
        expect(data.payload).not.toHaveProperty('waitingHours')
      },
    )

    it('stamps no wait on a notice about work that is already done', async () => {
      const deps = makeDeps()
      deps.fakes.inboxItemLookup.findWaitingSince.mockResolvedValue(WAIT_STARTED)

      await handleWorkflowNotificationEvent(
        deps,
        event('review.reply.published', {
          replyId: unbrand(NOTIF_TEST_IDS.replyId),
          reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
          userId: null,
          authorId: unbrand(NOTIF_TEST_IDS.authorId),
          source: 'web',
        }),
      )

      const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
      expect(data.payload).not.toHaveProperty('waitingSince')
      expect(data.payload).not.toHaveProperty('waitingHours')
    })

    it('stamps no wait when nothing is waiting any more', async () => {
      const deps = makeDeps()
      deps.fakes.inboxItemLookup.findWaitingSince.mockResolvedValue(null)

      await handleWorkflowNotificationEvent(
        deps,
        event('inbox.inbox_item.escalated', {
          inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
          userId: unbrand(NOTIF_TEST_IDS.submitter),
          source: 'web',
        }),
      )

      const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
      expect(data.payload).not.toHaveProperty('waitingSince')
    })
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

  describe('a publication that was cancelled after approval', () => {
    // BQC-3.8 kept this fact's identifiers strictly UUID, unlike the older
    // reply families, so its envelope cannot reuse the short test ids.
    const CANCELLED_IDS = {
      replyId: '30000000-0000-4000-8000-0000000000c1',
      reviewId: '30000000-0000-4000-8000-0000000000c2',
      propertyId: '30000000-0000-4000-8000-0000000000c3',
    } as const

    const cancelled = (
      cause: 'disconnect' | 'policy' | 'source_changed' | 'provider_truth',
      authorId: string | null = unbrand(NOTIF_TEST_IDS.authorId),
    ) =>
      event(
        'review.reply.publication_cancelled',
        { ...CANCELLED_IDS, authorId, cause },
        { propertyId: CANCELLED_IDS.propertyId },
      )

    it('tells the author and the admins who can re-approve it', async () => {
      const deps = makeDeps()
      deps.fakes.userLookup.findByRole.mockResolvedValue([
        NOTIF_TEST_IDS.admin1,
        NOTIF_TEST_IDS.admin2,
      ])

      await handleWorkflowNotificationEvent(deps, cancelled('disconnect'))

      expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
        expect.objectContaining({
          userId: NOTIF_TEST_IDS.authorId,
          type: 'reply.publication_cancelled',
          audience: { kind: 'property_operator' },
        }),
        expect.objectContaining({
          userId: NOTIF_TEST_IDS.admin1,
          type: 'reply.publication_cancelled',
          audience: { kind: 'account_admin' },
        }),
        expect.objectContaining({
          userId: NOTIF_TEST_IDS.admin2,
          type: 'reply.publication_cancelled',
          audience: { kind: 'account_admin' },
        }),
      ])
    })

    it('tells the admins alone when the fact names no author', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(deps, cancelled('source_changed', null))

      expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
        expect.objectContaining({
          userId: NOTIF_TEST_IDS.admin1,
          type: 'reply.publication_cancelled',
        }),
      ])
    })

    it('names an author who is also an admin once', async () => {
      const deps = makeDeps()
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.authorId])

      await handleWorkflowNotificationEvent(deps, cancelled('provider_truth'))

      expect(deps.fakes.jobs.map((job) => job.data)).toEqual([
        expect.objectContaining({
          userId: NOTIF_TEST_IDS.authorId,
          audience: { kind: 'property_operator' },
        }),
      ])
    })

    // A policy cancellation is what an Archive or a lost authority looks like:
    // the approver it took the authority from cannot re-approve anything.
    it('leaves out an approver who just lost authority over the Property', async () => {
      const deps = makeDeps()
      deps.fakes.userLookup.findByRole.mockResolvedValue([
        NOTIF_TEST_IDS.admin1,
        NOTIF_TEST_IDS.admin2,
      ])
      deps.fakes.responsibleManagers.isEligibleForProperty.mockImplementation(
        async (_org: unknown, _property: unknown, user: unknown) =>
          user !== NOTIF_TEST_IDS.admin2,
      )

      await handleWorkflowNotificationEvent(deps, cancelled('policy'))

      expect(
        deps.fakes.jobs.map((job) => (job.data as InsertNotificationJobData).userId),
      ).toEqual([NOTIF_TEST_IDS.authorId, NOTIF_TEST_IDS.admin1])
    })

    it('keeps every approver for a cancellation that took nobody’s authority', async () => {
      const deps = makeDeps()
      deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
      deps.fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)

      await handleWorkflowNotificationEvent(deps, cancelled('disconnect'))

      expect(
        deps.fakes.jobs.map((job) => (job.data as InsertNotificationJobData).userId),
      ).toEqual([NOTIF_TEST_IDS.authorId, NOTIF_TEST_IDS.admin1])
    })

    it.each([
      [
        'disconnect',
        'The Google connection was disconnected before it went out. The draft is saved: reconnect Google, then approve it again.',
      ],
      [
        'policy',
        'This property can no longer publish to Google, so it was never sent. The draft is saved.',
      ],
      [
        'source_changed',
        'The guest changed their review, so the approved text was never sent. Open it to write a reply to the new review.',
      ],
      [
        'provider_truth',
        'A different reply is already live on Google, so this one was never sent. Open it to check.',
      ],
    ] as const)('says why it was cancelled for cause %s', async (cause, body) => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(deps, cancelled(cause))

      const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
      expect(
        renderNotification(
          'reply.publication_cancelled',
          parseNotificationPayload(data.payload),
        ),
      ).toMatchObject({
        title: 'Reply returned to draft at Riverside Hotel',
        body,
      })
    })
  })

  it('carries what happened to an unpublished reply from its recorded fact', async () => {
    const fact = reviewReplyPublishFailed({
      replyId: NOTIF_TEST_IDS.replyId,
      reviewId: NOTIF_TEST_IDS.reviewId,
      propertyId: NOTIF_TEST_IDS.propId,
      organizationId: NOTIF_TEST_IDS.orgId,
      authorId: NOTIF_TEST_IDS.authorId,
      outcome: 'unconfirmed',
      occurredAt: NOTIF_TEST_IDS.now,
    })
    const row = toOutboxEvent(fact)
    const deps = makeDeps()

    await handleWorkflowNotificationEvent(
      deps,
      buildConsumerEvent({
        id: fact.eventId,
        eventType: row.eventType,
        eventVersion: row.eventVersion ?? 1,
        payload: row.payload,
        organizationId: row.organizationId,
        propertyId: row.propertyId ?? null,
        sourceContext: row.sourceContext,
        sourceAggregateId: row.sourceAggregateId,
        recordedAt: NOTIF_TEST_IDS.now,
      }),
    )

    const data = deps.fakes.jobs[0]!.data as InsertNotificationJobData
    expect(data.payload).toMatchObject({ publishOutcome: 'unconfirmed' })
    expect(
      renderNotification('reply.publish_failed', parseNotificationPayload(data.payload)),
    ).toMatchObject({
      title: 'Reply not confirmed on Google at Riverside Hotel',
      actionLabel: 'View reply',
    })
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
