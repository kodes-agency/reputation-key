// A settling fact handled late must not retire a newer request (N47 case 2).
//
// Settlement is keyed on (type, resource). A rejection whose consumer is
// retried after the author already resubmitted would otherwise settle the
// resubmission's approval request, which coalesced into the same row, and
// cancel the only email asking anybody to decide it.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxItemId,
  notificationId,
  propertyId,
  reviewId,
  userId,
  type NotificationId,
} from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { NotificationType } from '../domain/notification-types'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import { noGroupedReopens } from './jobs/test-fixtures'

const ORG = 'organization-newer-request'
const PROPERTY = propertyId('94000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('94000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('94000000-0000-4000-8000-000000000003')
const SETTLED = notificationId('94000000-0000-4000-8000-000000000005')
const ACTOR = userId('actor-newer-request')
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:00:00.000Z')

const makeDeps = (stillWaiting: ReadonlyArray<NotificationType>) => ({
  notifications: {
    settleUnreadForProperty: vi.fn(
      async (): Promise<ReadonlyArray<NotificationId>> => [],
    ),
    settleUnreadForResource: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [
      SETTLED,
    ]),
  },
  groupedReopens: noGroupedReopens(),
  emails: { cancelQueuedForNotifications: vi.fn(async () => 1) },
  inboxItemLookup: { findInboxItemByReviewId: vi.fn(async () => ITEM) },
  workState: {
    isWaiting: vi.fn(async () => true),
    finished: vi.fn(async ({ types }: { types: ReadonlyArray<NotificationType> }) =>
      types.filter((type) => !stillWaiting.includes(type)),
    ),
  },
  clock: () => NOW,
  logger: createMockLogger(),
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

const rejected = (): ConsumerEvent => ({
  eventId: '94000000-0000-4000-8000-0000000000aa',
  eventType: 'review.reply.rejected',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: PROPERTY,
    replyId: '94000000-0000-4000-8000-000000000004',
    reviewId: REVIEW,
    userId: ACTOR,
    authorId: ACTOR,
    source: 'web',
    occurredAt: OCCURRED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'review',
  sourceAggregateId: REVIEW,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a settling fact handled after the work was asked for again', () => {
  it('leaves the newer approval request waiting', async () => {
    const deps = makeDeps(['reply.pending_approval'])

    const outcome = await handleNotificationSettlementEvent(deps, rejected())

    expect(deps.workState.finished).toHaveBeenCalledWith({
      organizationId: ORG,
      resourceId: ITEM,
      types: ['reply.pending_approval'],
    })
    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
    expect(deps.emails.cancelQueuedForNotifications).not.toHaveBeenCalled()
    // The rule ran and decided: nothing to retry.
    expect(outcome).toEqual({ status: 'applied' })
  })

  it('still settles once the request is really finished', async () => {
    const deps = makeDeps([])

    await handleNotificationSettlementEvent(deps, rejected())

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['reply.pending_approval'], resourceId: ITEM }),
    )
  })
})
