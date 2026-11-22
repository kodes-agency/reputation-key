import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerWorkflowNotificationConsumers } from './inbox-notice-routes.server'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import {
  handleWorkflowNotificationEvent,
  WORKFLOW_NOTIFICATION_CONSUMERS,
  type WorkflowNotificationConsumerDeps,
} from './inbox-workflow.server'
import { NOTIF_TEST_IDS } from '../infrastructure/notification-consumer-test-fixtures'
import {
  assignedPayload,
  escalatedPayload,
  makeWorkflowDeps,
  noteAddedPayload,
  publishFailedPayload,
  replyPayload,
  WORKFLOW_EVENT_ID,
  firstJob,
  renderedFor,
  workflowEvent as event,
  type WorkflowTestDeps as Deps,
} from './workflow-consumer.test-fixtures'
import { unbrand } from '#/shared/domain/ids'
import type { QueuedNotice } from '../infrastructure/notification-consumer-test-fixtures'

// A fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = WORKFLOW_EVENT_ID
const makeDeps = makeWorkflowDeps

const IDS = NOTIF_TEST_IDS
const BULK_ID = '30000000-0000-4000-8000-000000000099'

type ItemFacts = NonNullable<
  Awaited<
    ReturnType<WorkflowNotificationConsumerDeps['inboxItemLookup']['findInboxItemFacts']>
  >
>

const itemFacts = (overrides: Partial<ItemFacts> = {}): ItemFacts => ({
  propertyId: unbrand(IDS.propId),
  portalId: null,
  assignedTo: null,
  propertyName: 'Riverside Hotel',
  guestRating: null,
  sourceType: 'review',
  createdAt: IDS.now,
  ...overrides,
})

const jobsData = (deps: Deps) => deps.fakes.jobs.map((job) => job.data as QueuedNotice)

const recipientsOf = (deps: Deps) => jobsData(deps).map((data) => data.userId as string)

const audienceOf = (deps: Deps) => firstJob(deps).audience
type RoutingRow = {
  name: string
  arrange?: (deps: Deps) => void
  actor: string
  recipients: readonly string[]
  audience?: unknown
  sorted?: boolean
}

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
      payload: assignedPayload({ assignedTo: IDS.manager1, userId: IDS.submitter }),
      notificationType: 'inbox.assigned',
    },
    {
      eventType: 'inbox.inbox_item.escalated' as const,
      payload: escalatedPayload(IDS.submitter),
      notificationType: 'inbox.escalated',
    },
    {
      eventType: 'inbox.inbox_note.added' as const,
      payload: noteAddedPayload(IDS.authorId),
      notificationType: 'inbox_note.added',
    },
    {
      eventType: 'review.reply.submitted' as const,
      payload: replyPayload({ userId: IDS.submitter }),
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
      payload: replyPayload({ userId: IDS.submitter, authorId: IDS.authorId }),
      notificationType,
    })),
  ])(
    'delivers $eventType through its durable route',
    async ({ eventType, payload, notificationType }) => {
      const deps = makeDeps()
      deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
        itemFacts({
          propertyId: IDS.propId,
          assignedTo: IDS.manager1,
          createdAt: new Date('2026-06-01T09:00:00.000Z'),
        }),
      )

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
      event('review.reply.publish_failed', publishFailedPayload(IDS.authorId, extra))

    await handleWorkflowNotificationEvent(
      deps,
      failure({ cause: 'google_reauthorization_required' }),
    )
    await handleWorkflowNotificationEvent(deps, failure({}))

    expect(deps.fakes.jobs.map(({ data }) => data)).toEqual([
      expect.objectContaining({
        userId: unbrand(IDS.authorId),
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
    const approval = event(
      'review.reply.approved',
      replyPayload({ userId: IDS.submitter, authorId: IDS.authorId }),
    )

    await handleWorkflowNotificationEvent(deps, approval)
    await handleWorkflowNotificationEvent(deps, approval)

    expect(deps.fakes.jobs.map(({ opts }) => opts)).toEqual([
      { jobId: `${EVENT_ID}-${unbrand(IDS.authorId)}` },
      { jobId: `${EVENT_ID}-${unbrand(IDS.authorId)}` },
    ])
  })

  it('preserves bulkId and lets the grouped completion fact own delivery', async () => {
    const deps = makeDeps()

    await expect(
      handleWorkflowNotificationEvent(
        deps,
        event(
          'inbox.inbox_item.assigned',
          assignedPayload({
            assignedTo: IDS.manager1,
            userId: IDS.submitter,
            bulkId: BULK_ID,
          }),
        ),
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

  // "Assigned to you" stops waiting on whoever held the item once it moves on,
  // whether or not they are told.
  describe('an item moving away from its holder', () => {
    const moved = (extra: Partial<Parameters<typeof assignedPayload>[0]> = {}) =>
      event(
        'inbox.inbox_item.assigned',
        assignedPayload({
          assignedTo: IDS.manager2,
          previousAssignee: IDS.manager1,
          userId: IDS.manager1,
          ...extra,
        }),
      )

    it('retires the holder\'s "Assigned to you" when they hand it on themselves', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(deps, moved())

      expect(deps.fakes.retireMovedAssignment).toHaveBeenCalledWith({
        organizationId: IDS.orgId,
        userId: IDS.manager1,
        inboxItemId: IDS.inboxItemId,
        eventId: EVENT_ID,
        at: expect.any(Date),
      })
      // They are not told about their own handoff; only the new holder is.
      expect(jobsData(deps).map((data) => data.type)).toEqual(['inbox.assigned'])
    })

    it('retires it when the item moves in bulk, which notifies per group', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(deps, moved({ bulkId: BULK_ID }))

      expect(deps.fakes.retireMovedAssignment).toHaveBeenCalledOnce()
      expect(deps.fakes.jobs).toEqual([])
    })

    it('retires nothing for a first assignment', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(
        deps,
        moved({ previousAssignee: null, userId: IDS.submitter }),
      )

      expect(deps.fakes.retireMovedAssignment).not.toHaveBeenCalled()
    })
  })

  describe('never tells a person about their own action', () => {
    it('skips the notice when a manager assigns the item to themselves', async () => {
      const deps = makeDeps()

      await expect(
        handleWorkflowNotificationEvent(
          deps,
          event(
            'inbox.inbox_item.assigned',
            assignedPayload({ assignedTo: IDS.manager1, userId: IDS.manager1 }),
          ),
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
        payload: escalatedPayload(IDS.admin1),
      },
      {
        eventType: 'review.reply.submitted' as const,
        payload: replyPayload({ userId: IDS.admin1 }),
      },
    ])(
      'tells the other AccountAdmins, not the admin who acted, about $eventType',
      async ({ eventType, payload }) => {
        const deps = makeDeps()
        // The AccountAdmin fallback: the Property has no responsible manager
        // who could take either notice, so both fall through to the admins.
        deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([])
        deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1, IDS.admin2])

        await handleWorkflowNotificationEvent(deps, event(eventType, payload))

        expect(recipientsOf(deps)).toEqual([IDS.admin2])
      },
    )

    it.each(['review.reply.approved', 'review.reply.rejected'] as const)(
      'skips the author notice when the author decided %s on their own reply',
      async (eventType) => {
        const deps = makeDeps()

        await expect(
          handleWorkflowNotificationEvent(
            deps,
            event(
              eventType,
              replyPayload({ userId: IDS.authorId, authorId: IDS.authorId }),
            ),
          ),
        ).resolves.toEqual({ status: 'applied' })

        expect(deps.fakes.jobs).toEqual([])
      },
    )
  })

  // An approval request goes to the Property's responsible managers who may
  // approve, not to every AccountAdmin in the Organization.
  describe('who is asked to approve a reply', () => {
    const rows: readonly RoutingRow[] = [
      {
        name: 'asks the responsible managers who may approve, not every admin',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
            IDS.manager1,
            IDS.manager2,
          ])
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1])
        },
        actor: IDS.submitter,
        recipients: [IDS.manager1, IDS.manager2],
        audience: { kind: 'reply_approver', propertyId: unbrand(IDS.propId) },
      },
      {
        name: 'leaves out a responsible manager who may not approve replies',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
            IDS.manager1,
            IDS.manager2,
          ])
          deps.fakes.replyApproval.canApproveReplies.mockImplementation(
            async (_org: string, _property: string, candidate: string) =>
              candidate === IDS.manager2,
          )
        },
        actor: IDS.submitter,
        recipients: [IDS.manager2],
      },
      {
        name: 'falls back to the AccountAdmins when no responsible manager may approve',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([IDS.manager1])
          deps.fakes.replyApproval.canApproveReplies.mockResolvedValue(false)
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1, IDS.admin2])
        },
        actor: IDS.submitter,
        recipients: [IDS.admin1, IDS.admin2],
        audience: { kind: 'account_admin' },
      },
      {
        name: 'never asks the submitter, even when they are the only approver',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([IDS.manager1])
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1])
        },
        actor: IDS.manager1,
        recipients: [IDS.admin1],
      },
    ]

    for (const { name, arrange, actor, recipients, audience } of rows) {
      it(name, async () => {
        const deps = makeDeps()
        arrange?.(deps)

        await handleWorkflowNotificationEvent(
          deps,
          event('review.reply.submitted', replyPayload({ userId: actor })),
        )

        expect(recipientsOf(deps)).toEqual(recipients)
        if (audience) expect(audienceOf(deps)).toEqual(audience)
      })
    }
  })

  // The same rule for escalations: the Property's or Portal's responsible
  // scope first, AccountAdmins only when it has nobody.
  describe('who hears that an item was escalated', () => {
    const rows: readonly RoutingRow[] = [
      {
        name: 'tells the Property responsible managers rather than every admin',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([IDS.manager1])
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1])
        },
        actor: IDS.submitter,
        recipients: [IDS.manager1],
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: unbrand(IDS.propId) },
        },
      },
      {
        name: 'tells the Portal responsible managers when the item is private feedback',
        arrange: (deps) => {
          deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
            itemFacts({ portalId: 'portal-1', sourceType: 'feedback' }),
          )
          deps.fakes.responsibleManagers.findForPortal.mockResolvedValue([IDS.manager2])
        },
        actor: IDS.submitter,
        recipients: [IDS.manager2],
      },
      {
        name: 'falls back to the AccountAdmins when the scope has nobody',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([])
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1])
        },
        actor: IDS.submitter,
        recipients: [IDS.admin1],
      },
      {
        name: 'never tells whoever escalated it',
        arrange: (deps) => {
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
            IDS.manager1,
            IDS.manager2,
          ])
        },
        actor: IDS.manager1,
        recipients: [IDS.manager2],
      },
    ]

    for (const { name, arrange, actor, recipients, audience } of rows) {
      it(name, async () => {
        const deps = makeDeps()
        arrange?.(deps)

        await handleWorkflowNotificationEvent(
          deps,
          event('inbox.inbox_item.escalated', escalatedPayload(actor)),
        )

        expect(recipientsOf(deps)).toEqual(recipients)
        if (audience) expect(audienceOf(deps)).toEqual(audience)
      })
    }
  })

  // A previous assignee is told the item moved on. An eligibility-loss
  // release stays silent: it carries no new assignee, so it is not a
  // reassignment.
  describe('who hears that an item moved to somebody else', () => {
    const reassigned = (
      previousAssignee: string | null,
      userId: string = IDS.submitter,
    ) =>
      event(
        'inbox.inbox_item.assigned',
        assignedPayload({ assignedTo: IDS.manager2, previousAssignee, userId }),
      )

    it('tells the previous assignee, beside the new one', async () => {
      const deps = makeDeps()

      await handleWorkflowNotificationEvent(deps, reassigned(IDS.manager1))

      const byUser = new Map(
        jobsData(deps).map((data) => [data.userId as string, data.type]),
      )
      expect(byUser.get(IDS.manager2)).toBe('inbox.assigned')
      expect(byUser.get(IDS.manager1)).toBe('inbox.unassigned')
    })

    const quietRows = [
      {
        name: 'tells nobody extra when the item had no previous assignee',
        incoming: reassigned(null),
        recipients: [IDS.manager2],
      },
      {
        name: 'never tells a previous assignee who reassigned it themselves',
        incoming: reassigned(IDS.manager1, IDS.manager1),
        recipients: [IDS.manager2],
      },
      {
        name: 'says nothing on a claim, where the previous assignee is the claimant',
        incoming: event(
          'inbox.inbox_item.assigned',
          assignedPayload({
            assignedTo: IDS.manager1,
            previousAssignee: IDS.manager1,
            userId: IDS.manager1,
          }),
        ),
        recipients: [],
      },
    ]

    for (const { name, incoming, recipients } of quietRows) {
      it(name, async () => {
        const deps = makeDeps()

        await handleWorkflowNotificationEvent(deps, incoming)

        expect(recipientsOf(deps)).toEqual(recipients)
      })
    }
  })

  // A note written by the assignee still reaches somebody, so notes can be
  // used to ask for help.
  describe('who hears about a note', () => {
    const noteAdded = (actorId: string) =>
      event('inbox.inbox_note.added', noteAddedPayload(actorId))

    const assignedTo = (deps: Deps, assignee: ItemFacts['assignedTo']) =>
      deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
        itemFacts({ assignedTo: assignee }),
      )

    const withScopeAndEarlierAuthor = (deps: Deps) => {
      assignedTo(deps, IDS.manager1)
      deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([IDS.manager2])
      deps.fakes.inboxItemLookup.findNoteAuthors.mockResolvedValue([IDS.authorId])
    }

    const rows: readonly RoutingRow[] = [
      {
        name: 'reaches the assignee, the responsible scope and the earlier note authors',
        arrange: withScopeAndEarlierAuthor,
        actor: IDS.submitter,
        recipients: [IDS.manager1, IDS.manager2, IDS.authorId].sort(),
        sorted: true,
      },
      {
        name: 'reaches the responsible scope when the assignee wrote the note',
        arrange: (deps) => {
          assignedTo(deps, IDS.manager1)
          deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([IDS.manager2])
        },
        actor: IDS.manager1,
        recipients: [IDS.manager2],
      },
      {
        name: 'falls back to the AccountAdmins when the item itself is gone',
        arrange: (deps) => {
          deps.fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue(null)
          deps.fakes.userLookup.findByRole.mockResolvedValue([IDS.admin1])
        },
        actor: IDS.submitter,
        recipients: [IDS.admin1],
      },
    ]

    for (const { name, arrange, actor, recipients, sorted } of rows) {
      it(name, async () => {
        const deps = makeDeps()
        arrange?.(deps)

        await handleWorkflowNotificationEvent(deps, noteAdded(actor))

        const heard = recipientsOf(deps)
        expect(sorted ? heard.sort() : heard).toEqual(recipients)
      })
    }

    it('never tells the person who wrote the note', async () => {
      const deps = makeDeps()
      assignedTo(deps, IDS.manager1)
      deps.fakes.inboxItemLookup.findNoteAuthors.mockResolvedValue([
        IDS.submitter,
        IDS.authorId,
      ])

      await handleWorkflowNotificationEvent(deps, noteAdded(IDS.submitter))

      expect(recipientsOf(deps)).not.toContain(IDS.submitter)
    })

    it('names why each recipient was admitted, so the send can recheck it', async () => {
      const deps = makeDeps()
      withScopeAndEarlierAuthor(deps)

      await handleWorkflowNotificationEvent(deps, noteAdded(IDS.submitter))

      const audiences = new Map(
        jobsData(deps).map((data) => [data.userId as string, data.audience]),
      )
      expect(audiences.get(IDS.manager1)).toEqual({
        kind: 'inbox_assignee',
        inboxItemId: IDS.inboxItemId,
      })
      expect(audiences.get(IDS.manager2)).toEqual({
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: unbrand(IDS.propId) },
      })
      expect(audiences.get(IDS.authorId)).toEqual({
        kind: 'inbox_note_author',
        inboxItemId: IDS.inboxItemId,
      })
    })
  })

  it('names the role of whoever escalated, since escalation is always a manual call', async () => {
    const deps = makeDeps()

    await handleWorkflowNotificationEvent(
      deps,
      event('inbox.inbox_item.escalated', escalatedPayload(IDS.submitter)),
    )

    expect(deps.fakes.userLookup.findActorRole).toHaveBeenCalledWith(
      IDS.submitter,
      IDS.orgId,
    )
    expect(firstJob(deps).payload).toMatchObject({ actorRole: 'property_manager' })
    expect(renderedFor(deps, 'inbox.escalated').body).toMatch(
      /^A property manager escalated this/,
    )
  })

  describe('how long something has waited', () => {
    const WAIT_STARTED = new Date('2026-06-01T07:00:00.000Z')

    it.each([
      {
        eventType: 'inbox.inbox_item.escalated' as const,
        payload: escalatedPayload(IDS.submitter),
      },
      {
        eventType: 'review.reply.submitted' as const,
        payload: replyPayload({ userId: IDS.submitter }),
      },
    ])(
      "stamps $eventType with when the current wait began, not the item's age",
      async ({ eventType, payload }) => {
        const deps = makeDeps()
        deps.fakes.inboxItemLookup.findWaitingSince.mockResolvedValue(WAIT_STARTED)

        await handleWorkflowNotificationEvent(deps, event(eventType, payload))

        const data = firstJob(deps)
        expect(deps.fakes.inboxItemLookup.findWaitingSince).toHaveBeenCalledWith(
          IDS.inboxItemId,
          IDS.orgId,
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
        event(
          'review.reply.published',
          replyPayload({ userId: null, authorId: IDS.authorId }),
        ),
      )

      const data = firstJob(deps)
      expect(data.payload).not.toHaveProperty('waitingSince')
      expect(data.payload).not.toHaveProperty('waitingHours')
    })

    it('stamps no wait when nothing is waiting any more', async () => {
      const deps = makeDeps()
      deps.fakes.inboxItemLookup.findWaitingSince.mockResolvedValue(null)

      await handleWorkflowNotificationEvent(
        deps,
        event('inbox.inbox_item.escalated', escalatedPayload(IDS.submitter)),
      )

      expect(firstJob(deps).payload).not.toHaveProperty('waitingSince')
    })
  })

  it.each([
    {
      eventType: 'inbox.inbox_item.escalated' as const,
      payload: escalatedPayload(null, 'import'),
    },
    {
      eventType: 'inbox.inbox_note.added' as const,
      payload: noteAddedPayload(null, 'import'),
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
      replyPayload({ userId: IDS.submitter, authorId: IDS.authorId }),
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
          ...escalatedPayload(null, 'import'),
          propertyId: null,
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
        event(
          'review.reply.approved',
          replyPayload({ userId: IDS.submitter, authorId: IDS.authorId }),
        ),
      ),
    ).rejects.toThrow('Queue unavailable')

    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
