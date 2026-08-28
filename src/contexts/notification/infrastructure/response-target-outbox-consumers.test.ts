import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  clearConsumers,
  listRegisteredConsumers,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type {
  InboxItemFacts,
  ResponseTargetReminderNotificationFacts,
} from '../application/ports/inbox-item-lookup.port'
import {
  handleNotificationResponseTargetReminder,
  ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
  registerResponseTargetNotificationConsumer,
} from './response-target-outbox-consumers'

const EVENT_ID = '94000000-0000-4000-8000-000000000001'
const ITEM = inboxItemId('94000000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('94000000-0000-4000-8000-000000000003')
const SOURCE = '94000000-0000-4000-8000-000000000004'
const PORTAL = '94000000-0000-4000-8000-000000000005'
const ORG = organizationId('organization-response-target-notification')
const MANAGER = userId('manager-response-target-notification')
const OWNER = userId('owner-response-target-notification')
const ADMIN = userId('admin-response-target-notification')
const ASSIGNEE = userId('assignee-response-target-notification')
const SCHEDULED_FOR = '2026-08-28T10:00:00.000Z'
const OCCURRED_AT = '2026-08-28T10:00:01.000Z'

const event = (
  payloadOverrides: Record<string, unknown> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.response_target.reminder_due',
  eventVersion: 1,
  payload: {
    inboxItemId: ITEM,
    cycleNumber: 2,
    organizationId: ORG,
    propertyId: PROPERTY,
    targetKind: 'private_feedback_handling',
    reminderKind: 'halfway',
    scheduledFor: SCHEDULED_FOR,
    userId: null,
    source: 'import',
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

const currentFacts = (): ResponseTargetReminderNotificationFacts => ({
  propertyId: PROPERTY,
  portalId: PORTAL,
  assignedTo: null,
  propertyName: 'Riverside Hotel',
  guestRating: 2,
  sourceType: 'feedback',
  sourceId: SOURCE,
  createdAt: new Date('2026-08-28T08:00:00.000Z'),
  currentCycleNumber: 2,
  currentSourceRevision: 1,
  stateRevision: 3,
  status: 'open',
  targetKind: 'private_feedback_handling',
  reminderKind: 'halfway',
  scheduledFor: new Date(SCHEDULED_FOR),
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: unknown; opts?: unknown }> = []
  const facts = currentFacts()
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
      findActorRole: vi.fn(async () => null),
    },
    responsibleManagers: {
      findForProperty: vi.fn(async () => [MANAGER, OWNER]),
      findForPortal: vi.fn(async () => [MANAGER, OWNER]),
      findForPortalGroup: vi.fn(async () => []),
      isEligibleForProperty: vi.fn(async () => true),
    },
    inboxItemLookup: {
      findInboxItemByReviewId: vi.fn(async () => ITEM),
      findInboxItemFacts: vi.fn(async (): Promise<InboxItemFacts | null> => facts),
      findHandlingCycleNotificationFacts: vi.fn(async () => facts),
      findResponseTargetReminderNotificationFacts: vi.fn(
        async (): Promise<ResponseTargetReminderNotificationFacts | null> => facts,
      ),
    },
    clock: () => new Date('2026-08-28T11:00:00.000Z'),
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

describe('Response Target reminder durable consumer', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers the stable durable consumer identity', () => {
    registerResponseTargetNotificationConsumer(makeDeps())
    expect(listRegisteredConsumers()).toEqual([
      {
        eventType: 'inbox.response_target.reminder_due',
        consumerName: ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
      },
    ])
  })

  it.each([
    ['halfway', 'inbox.response_target_halfway'],
    ['target_passed', 'inbox.response_target_passed'],
  ] as const)(
    'delivers one calm %s reminder to exact Portal responsibility',
    async (kind, type) => {
      const deps = makeDeps()
      if (kind === 'target_passed') {
        deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
          {
            ...currentFacts(),
            reminderKind: kind,
          },
        )
      }

      await expect(
        handleNotificationResponseTargetReminder(deps, event({ reminderKind: kind })),
      ).resolves.toEqual({ status: 'applied' })

      expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)
      expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
      expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
        MANAGER,
        OWNER,
      ])
      expect(deps.jobs[0]).toEqual(
        expect.objectContaining({
          name: 'insert-notification',
          opts: { jobId: `${EVENT_ID}-${MANAGER}` },
          data: expect.objectContaining({
            type,
            organizationId: ORG,
            propertyId: PROPERTY,
            resourceType: 'inbox_item',
            resourceId: ITEM,
            eventId: EVENT_ID,
            audience: expect.objectContaining({
              kind: 'response_target_reminder',
              inboxItemId: ITEM,
              sourceType: 'feedback',
              sourceId: SOURCE,
              cycleNumber: 2,
              sourceRevision: 1,
              stateRevision: 3,
              targetKind: 'private_feedback_handling',
              reminderKind: kind,
              scheduledFor: SCHEDULED_FOR,
            }),
          }),
        }),
      )
      expect(JSON.stringify(deps.jobs)).not.toMatch(
        /snippet|reviewer|guestText|comment|content|feedbackText/i,
      )
    },
  )

  it('narrows an assigned halfway reminder to the current eligible assignee', async () => {
    const deps = makeDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      ...currentFacts(),
      assignedTo: ASSIGNEE,
    })

    await expect(
      handleNotificationResponseTargetReminder(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      ASSIGNEE,
    ])
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      ASSIGNEE,
    )
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
  })

  it('falls back to scoped responsibility when the assigned halfway recipient is no longer eligible', async () => {
    const deps = makeDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      ...currentFacts(),
      assignedTo: ASSIGNEE,
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)

    await expect(
      handleNotificationResponseTargetReminder(deps, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      MANAGER,
      OWNER,
    ])
    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)
  })

  it('adds the current eligible assignee to a Google target-passed Property responsibility', async () => {
    const deps = makeDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      ...currentFacts(),
      portalId: null,
      assignedTo: ASSIGNEE,
      guestRating: null,
      sourceType: 'review',
      targetKind: 'google_review_response',
      reminderKind: 'target_passed',
    })

    await expect(
      handleNotificationResponseTargetReminder(
        deps,
        event({
          targetKind: 'google_review_response',
          reminderKind: 'target_passed',
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      MANAGER,
      OWNER,
      ASSIGNEE,
    ])
    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
  })

  it('does not enqueue a duplicate target-passed reminder when the assignee is already responsible', async () => {
    const deps = makeDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      ...currentFacts(),
      assignedTo: MANAGER,
      reminderKind: 'target_passed',
    })

    await expect(
      handleNotificationResponseTargetReminder(
        deps,
        event({ reminderKind: 'target_passed' }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual([
      MANAGER,
      OWNER,
    ])
  })

  it.each([
    ['missing or completed target', null],
    ['later cycle', { currentCycleNumber: 3 }],
    ['closed cycle', { status: 'closed' }],
    ['different Property', { propertyId: '94000000-0000-4000-8000-000000000099' }],
    ['different reminder', { reminderKind: 'target_passed' }],
  ] as const)('marks a %s event obsolete without delivery', async (_label, change) => {
    const deps = makeDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
      change === null ? null : { ...currentFacts(), ...change },
    )

    await expect(
      handleNotificationResponseTargetReminder(deps, event()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
      'obsolete',
    )
  })

  it('rejects envelope attribution drift before looking up target state', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationResponseTargetReminder(
        deps,
        event({}, { organizationId: 'another-organization' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(
      deps.inboxItemLookup.findResponseTargetReminderNotificationFacts,
    ).not.toHaveBeenCalled()
  })

  it('leaves a partial fan-out retryable with stable recipient job identities', async () => {
    const deps = makeDeps()
    deps.queue.add.mockRejectedValueOnce(new Error('queue unavailable'))
    await expect(handleNotificationResponseTargetReminder(deps, event())).rejects.toThrow(
      'queue unavailable',
    )
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
