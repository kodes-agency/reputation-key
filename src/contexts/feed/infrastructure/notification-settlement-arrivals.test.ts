// Notices that asked for work and were never retired once it was done.
//
// "New review … Open it to read the review and reply", "New guest feedback …
// Open it to read the feedback" and "Review updated" stayed unread after the
// review was answered or the feedback handled or withdrawn, and a deferred
// email or the next digest still asked for it (N37, N43). "Reply not
// published" stayed waiting after a cancellation returned the reply to draft,
// where nothing is left to retry (N07).

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
import { isStillActionable } from '../domain/notification-settlement'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import { noGroupedReopens, waitingWorkState } from './jobs/test-fixtures'

const ORG = 'organization-arrivals'
const PROPERTY = propertyId('96000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('96000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('96000000-0000-4000-8000-000000000003')
const SETTLED = notificationId('96000000-0000-4000-8000-000000000005')
const GUEST_FEEDBACK = '96000000-0000-4000-8000-000000000007'
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:00:00.000Z')

const makeDeps = () => ({
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
  workState: waitingWorkState(),
  clock: () => NOW,
  logger: createMockLogger(),
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

const envelope = (
  eventType: string,
  payload: Record<string, unknown>,
): ConsumerEvent => ({
  eventId: '96000000-0000-4000-8000-0000000000aa',
  eventType,
  eventVersion: 1,
  payload: { organizationId: ORG, propertyId: PROPERTY, ...payload },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: eventType.startsWith('review.') ? 'review' : 'inbox',
  sourceAggregateId: ITEM,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

const closed = (sourceType: 'review' | 'feedback', closeReason: string) =>
  envelope('inbox.handling_cycle.closed', {
    inboxItemId: ITEM,
    cycleNumber: 1,
    stateRevision: 2,
    sourceType,
    sourceId: sourceType === 'review' ? REVIEW : GUEST_FEEDBACK,
    sourceRevision: 1,
    actorType: closeReason === 'guest_withdrawn' ? 'guest' : 'provider',
    userId: null,
    triggerEventId: null,
    closeReason,
    source: 'web',
    occurredAt: OCCURRED_AT.toISOString(),
  })

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a closed Handling Cycle retires the arrival that asked for it', () => {
  it('retires "New review" and "Review updated" once the reply is live', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(deps, closed('review', 'confirmed_on_google'))

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: ITEM,
        types: expect.arrayContaining(['review.created', 'review.updated']),
      }),
    )
  })

  it('retires "New guest feedback" once the guest withdraws it', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(deps, closed('feedback', 'guest_withdrawn'))

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: ITEM,
        types: expect.arrayContaining(['feedback.created']),
      }),
    )
    expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalled()
  })

  it('holds back the email of an arrival that was settled', () => {
    const settled = { status: 'unread' as const, readAt: null, resolvedAt: NOW }

    expect(isStillActionable({ ...settled, type: 'review.created' })).toBe(false)
    expect(isStillActionable({ ...settled, type: 'feedback.created' })).toBe(false)
    expect(isStillActionable({ ...settled, type: 'review.updated' })).toBe(false)
  })
})

describe('a publication cancelled back to draft', () => {
  it('retires "Reply not published", which has nothing left to retry', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('review.reply.publication_cancelled', {
        replyId: '96000000-0000-4000-8000-000000000004',
        reviewId: REVIEW,
        authorId: userId('author-arrivals'),
        cause: 'source_changed',
        occurredAt: OCCURRED_AT.toISOString(),
      }),
    )

    expect(deps.inboxItemLookup.findInboxItemByReviewId).toHaveBeenCalledWith(REVIEW, ORG)
    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith({
      organizationId: ORG,
      types: ['reply.publish_failed'],
      resourceId: ITEM,
      resolvedAt: NOW,
    })
  })
})
