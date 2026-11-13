// Notices that asked for work and were never retired once it was done.
//
// "New review … Open it to read the review and reply", "New guest feedback …
// Open it to read the feedback" and "Review updated" stayed unread after the
// review was answered or the feedback handled or withdrawn, and a deferred
// email or the next digest still asked for it (N37, N43). "Reply not
// published" stayed waiting after a cancellation returned the reply to draft,
// where nothing is left to retry (N07).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { inboxItemId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { isStillActionable } from '../domain/notification-actionable'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { seedNotice } from './jobs/delivery-seed'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import {
  MAIL_CANCELLED,
  queuedMail,
  settledAt,
  settlementDeps,
} from './notification-settlement-test-db'

const ORG = 'organization-arrivals'
const PROPERTY = propertyId('96000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('96000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('96000000-0000-4000-8000-000000000003')
const GUEST_FEEDBACK = '96000000-0000-4000-8000-000000000007'
const RECIPIENT = 'recipient-arrivals'
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:00:00.000Z')

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

describe.sequential('arrivals that asked for work (real PostgreSQL)', () => {
  let held: HeldTransaction

  const waiting = (name: string, type: string) =>
    seedNotice(held.db, {
      name,
      organizationId: ORG,
      userId: RECIPIENT,
      propertyId: PROPERTY,
      createdAt: OCCURRED_AT,
      type,
      resourceType: 'inbox_item',
      resourceId: ITEM,
    })

  beforeAll(async () => {
    registerAllEventSchemas()
    held = await holdTransaction()
    await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  describe('a closed Handling Cycle retires the arrival that asked for it', () => {
    it('retires "New review" and "Review updated" once the reply is live', async () => {
      await waiting('closed-review-created', 'review.created')
      await waiting('closed-review-updated', 'review.updated')

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        closed('review', 'confirmed_on_google'),
      )

      expect(await settledAt(held.db, 'closed-review-created')).toEqual(NOW)
      expect(await settledAt(held.db, 'closed-review-updated')).toEqual(NOW)
    })

    it('retires "New guest feedback" once the guest withdraws it, and its queued email', async () => {
      await waiting('withdrawn-feedback', 'feedback.created')

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        closed('feedback', 'guest_withdrawn'),
      )

      expect(await settledAt(held.db, 'withdrawn-feedback')).toEqual(NOW)
      expect(await queuedMail(held.db, 'withdrawn-feedback')).toEqual(MAIL_CANCELLED)
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
      await waiting('cancelled-publish-failed', 'reply.publish_failed')
      await waiting('cancelled-pending-approval', 'reply.pending_approval')
      const deps = settlementDeps(held.db, { now: NOW, item: ITEM })

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

      expect(deps.inboxItemLookup.findInboxItemByReviewId).toHaveBeenCalledWith(
        REVIEW,
        ORG,
      )
      expect(await settledAt(held.db, 'cancelled-publish-failed')).toEqual(NOW)
      expect(await settledAt(held.db, 'cancelled-pending-approval')).toEqual(NOW)
    })
  })
})
