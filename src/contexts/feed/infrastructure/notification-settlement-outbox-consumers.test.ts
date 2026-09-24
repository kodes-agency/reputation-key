import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxItemId,
  notificationId,
  portalId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { SETTLED_EMAIL_REASON } from '../domain/notification-settlement'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import type { InboxItemId, NotificationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  handleNotificationSettlementEvent,
  NOTIFICATION_SETTLEMENT_CONSUMERS,
  registerNotificationSettlementConsumers,
} from './notification-settlement-outbox-consumers'

const ORG = 'organization-settlement'
const PROPERTY = propertyId('93000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('93000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('93000000-0000-4000-8000-000000000003')
const REPLY = '93000000-0000-4000-8000-000000000004'
const PORTAL = portalId('93000000-0000-4000-8000-000000000006')
const SETTLED = notificationId('93000000-0000-4000-8000-000000000005')
const ACTOR = userId('actor-settlement')
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:00:00.000Z')

type SettleInput = Parameters<NotificationRepositoryPort['settleUnreadForResource']>[0]
type CancelArgs = Parameters<
  NotificationEmailRepositoryPort['cancelQueuedForNotifications']
>

const makeDeps = () => ({
  notifications: {
    settleUnreadForResource: vi.fn(
      async (_input: SettleInput): Promise<ReadonlyArray<NotificationId>> => [SETTLED],
    ),
  },
  emails: {
    cancelQueuedForNotifications: vi.fn(async (..._args: CancelArgs) => 1),
  },
  inboxItemLookup: {
    findInboxItemByReviewId: vi.fn(async (): Promise<InboxItemId | null> => ITEM),
  },
  clock: () => NOW,
  logger: createMockLogger(),
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

const envelope = (
  eventType: string,
  payload: Record<string, unknown>,
  eventId = '93000000-0000-4000-8000-0000000000aa',
): ConsumerEvent => ({
  eventId,
  eventType,
  // Portal lifecycle facts are recorded at v2; everything else here at v1.
  eventVersion: eventType.startsWith('portal.') ? 2 : 1,
  payload: { organizationId: ORG, propertyId: PROPERTY, ...payload },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'inbox',
  sourceAggregateId: ITEM,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

const replyPayload = {
  replyId: REPLY,
  reviewId: REVIEW,
  userId: ACTOR,
  authorId: ACTOR,
  source: 'web',
  occurredAt: OCCURRED_AT.toISOString(),
}

const closedPayload = {
  inboxItemId: ITEM,
  cycleNumber: 2,
  stateRevision: 3,
  sourceType: 'review',
  sourceId: REVIEW,
  sourceRevision: 1,
  actorType: 'user',
  userId: ACTOR,
  triggerEventId: null,
  closeReason: 'confirmed_on_google',
  source: 'web',
  occurredAt: OCCURRED_AT.toISOString(),
}

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a settling fact retires the notices that asked for the work', () => {
  it('retires the approval request when the reply is approved', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.approved', replyPayload),
    )

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: NOW,
    })
  })

  it('retires the failed publication too once the reply is live', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.published', replyPayload),
    )

    expect(deps.notifications.settleUnreadForResource.mock.calls[0]?.[0]).toMatchObject({
      types: ['reply.pending_approval', 'reply.publish_failed'],
      resourceId: ITEM,
    })
  })

  it('retires the escalation when it is resolved', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('inbox.inbox_item.escalation_resolved', {
        inboxItemId: ITEM,
        userId: ACTOR,
        source: 'web',
        occurredAt: OCCURRED_AT.toISOString(),
      }),
    )

    expect(deps.notifications.settleUnreadForResource.mock.calls[0]?.[0]).toMatchObject({
      types: ['inbox.escalated'],
      resourceId: ITEM,
    })
  })

  it('retires the reopen and the target reminders when the cycle closes', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('inbox.handling_cycle.closed', closedPayload),
    )

    expect(deps.notifications.settleUnreadForResource.mock.calls[0]?.[0]).toMatchObject({
      types: [
        'inbox.reopened',
        'inbox.response_target_halfway',
        'inbox.response_target_passed',
      ],
      resourceId: ITEM,
    })
  })

  it('retires the Property request once a manager is chosen again', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('property.responsible_managers.updated', {
        assignmentCount: 1,
        occurredAt: OCCURRED_AT.toISOString(),
      }),
    )

    expect(deps.notifications.settleUnreadForResource.mock.calls[0]?.[0]).toMatchObject({
      types: ['property.responsibility_needed'],
      resourceId: PROPERTY,
    })
  })

  it('retires the Portal request once a manager is chosen again', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('portal.responsible_managers.updated', {
        portalId: PORTAL,
        assignmentCount: 2,
        sourceAggregateVersion: OCCURRED_AT.toISOString(),
        occurredAt: OCCURRED_AT.toISOString(),
      }),
    )

    expect(deps.notifications.settleUnreadForResource.mock.calls[0]?.[0]).toMatchObject({
      types: ['portal.responsibility_needed'],
      resourceId: PORTAL,
    })
  })

  it('settles nothing when the selection left nobody responsible', async () => {
    const deps = makeDeps()

    const outcome = await handleNotificationSettlementEvent(
      deps,
      envelope('property.responsible_managers.updated', {
        assignmentCount: 0,
        occurredAt: OCCURRED_AT.toISOString(),
      }),
    )

    // That fact opens a gap; the responsibility-needed route announces it.
    expect(outcome).toEqual({ status: 'applied' })
    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
  })

  it('cancels the mail queued behind every notice it retired', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.approved', replyPayload),
    )

    expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalledWith(
      [SETTLED],
      ORG,
      SETTLED_EMAIL_REASON,
      NOW,
    )
  })

  it('cancels no mail when the work was already settled', async () => {
    const deps = makeDeps()
    deps.notifications.settleUnreadForResource.mockResolvedValue([])

    await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.approved', replyPayload),
    )

    expect(deps.emails.cancelQueuedForNotifications).not.toHaveBeenCalled()
  })

  it('records an applied receipt under its own consumer name', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.approved', replyPayload),
    )

    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      '93000000-0000-4000-8000-0000000000aa',
      'notification.settle-on-review-reply-approved',
      'applied',
    )
  })

  it('settles nothing, and says so, when the reply has no Inbox item left', async () => {
    const deps = makeDeps()
    deps.inboxItemLookup.findInboxItemByReviewId.mockResolvedValue(null)

    const outcome = await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.approved', replyPayload),
    )

    expect(outcome).toEqual({ status: 'obsolete' })
    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      '93000000-0000-4000-8000-0000000000aa',
      'notification.settle-on-review-reply-approved',
      'obsolete',
    )
  })

  it('refuses a fact whose tenant disagrees with its envelope', async () => {
    const deps = makeDeps()
    const crossTenant = {
      ...envelope('review.reply.approved', replyPayload),
      organizationId: 'organization-other',
    }

    await expect(handleNotificationSettlementEvent(deps, crossTenant)).rejects.toThrow(
      /attribution mismatch/,
    )
    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
  })

  it('registers one consumer per settling fact', () => {
    const registry = createConsumerRegistry()

    registerNotificationSettlementConsumers(registry, makeDeps())

    expect(
      registry
        .list()
        .filter((entry) => entry.consumerName.startsWith('notification.settle-'))
        .map((entry) => `${entry.eventType} ${entry.consumerName}`)
        .sort(),
    ).toEqual(
      NOTIFICATION_SETTLEMENT_CONSUMERS.map(
        (route) => `${route.eventType} ${route.consumerName}`,
      ).sort(),
    )
  })
})
