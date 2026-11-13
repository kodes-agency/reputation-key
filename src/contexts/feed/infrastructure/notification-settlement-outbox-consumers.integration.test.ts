import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { inboxItemId, portalId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { seedNotice } from './jobs/delivery-seed'
import {
  handleNotificationSettlementEvent,
  NOTIFICATION_SETTLEMENT_CONSUMERS,
  registerNotificationSettlementConsumers,
} from './notification-settlement-outbox-consumers'
import {
  MAIL_CANCELLED,
  MAIL_QUEUED,
  queuedMail,
  settledAt,
  settlementDeps,
} from './notification-settlement-test-db'

const ORG = 'organization-settlement'
const PROPERTY = propertyId('93000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('93000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('93000000-0000-4000-8000-000000000003')
const REPLY = '93000000-0000-4000-8000-000000000004'
const PORTAL = portalId('93000000-0000-4000-8000-000000000006')
const ACTOR = userId('actor-settlement')
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:00:00.000Z')

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

describe.sequential(
  'a settling fact retires the notices that asked for the work (real PostgreSQL)',
  () => {
    let held: HeldTransaction

    const waiting = (
      name: string,
      type: string,
      resourceId: string = ITEM,
      resourceType = 'inbox_item',
    ) =>
      seedNotice(held.db, {
        name,
        organizationId: ORG,
        userId: `recipient-${name}`,
        propertyId: PROPERTY,
        createdAt: OCCURRED_AT,
        type,
        resourceType,
        resourceId,
      })

    const deps = (item: typeof ITEM | null = ITEM) =>
      settlementDeps(held.db, { now: NOW, item })

    beforeAll(async () => {
      registerAllEventSchemas()
      held = await holdTransaction()
      await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
    })

    afterAll(async () => {
      await held?.rollBack()
    })

    it('retires the approval request when the reply is approved', async () => {
      await waiting('approved', 'reply.pending_approval')
      await waiting('approved-published-only', 'reply.publish_failed')

      await handleNotificationSettlementEvent(
        deps(),
        envelope('review.reply.approved', replyPayload),
      )

      expect(await settledAt(held.db, 'approved')).toEqual(NOW)
      expect(await settledAt(held.db, 'approved-published-only')).toBeNull()
    })

    it('retires the failed publication too once the reply is live', async () => {
      await waiting('live-pending', 'reply.pending_approval')
      await waiting('live-failed', 'reply.publish_failed')

      await handleNotificationSettlementEvent(
        deps(),
        envelope('review.reply.published', replyPayload),
      )

      expect(await settledAt(held.db, 'live-pending')).toEqual(NOW)
      expect(await settledAt(held.db, 'live-failed')).toEqual(NOW)
    })

    it('retires the escalation when it is resolved', async () => {
      await waiting('escalated', 'inbox.escalated')

      await handleNotificationSettlementEvent(
        deps(),
        envelope('inbox.inbox_item.escalation_resolved', {
          inboxItemId: ITEM,
          userId: ACTOR,
          source: 'web',
          occurredAt: OCCURRED_AT.toISOString(),
        }),
      )

      expect(await settledAt(held.db, 'escalated')).toEqual(NOW)
    })

    it('retires the arrival, the reopen, the target reminders and the assignment when the cycle closes', async () => {
      const types = [
        'review.created',
        'review.updated',
        'review.ai_urgent_detected',
        'feedback.created',
        'inbox.reopened',
        'inbox.response_target_halfway',
        'inbox.response_target_passed',
        'inbox.assigned',
      ]
      for (const type of types) await waiting(`cycle-${type}`, type)
      await waiting('cycle-untouched', 'inbox.escalated')

      await handleNotificationSettlementEvent(
        deps(),
        envelope('inbox.handling_cycle.closed', closedPayload),
      )

      for (const type of types) {
        expect(await settledAt(held.db, `cycle-${type}`)).toEqual(NOW)
      }
      expect(await settledAt(held.db, 'cycle-untouched')).toBeNull()
    })

    it('retires the Property request once a manager is chosen again', async () => {
      await waiting(
        'property-gap',
        'property.responsibility_needed',
        PROPERTY,
        'property',
      )

      await handleNotificationSettlementEvent(
        deps(),
        envelope('property.responsible_managers.updated', {
          assignmentCount: 1,
          occurredAt: OCCURRED_AT.toISOString(),
        }),
      )

      expect(await settledAt(held.db, 'property-gap')).toEqual(NOW)
    })

    it('retires the Portal request once a manager is chosen again', async () => {
      await waiting('portal-gap', 'portal.responsibility_needed', PORTAL, 'portal')

      await handleNotificationSettlementEvent(
        deps(),
        envelope('portal.responsible_managers.updated', {
          portalId: PORTAL,
          assignmentCount: 2,
          sourceAggregateVersion: OCCURRED_AT.toISOString(),
          occurredAt: OCCURRED_AT.toISOString(),
        }),
      )

      expect(await settledAt(held.db, 'portal-gap')).toEqual(NOW)
    })

    it('settles nothing when the selection left nobody responsible', async () => {
      await waiting('nobody-left', 'property.responsibility_needed', PROPERTY, 'property')

      const outcome = await handleNotificationSettlementEvent(
        deps(),
        envelope('property.responsible_managers.updated', {
          assignmentCount: 0,
          occurredAt: OCCURRED_AT.toISOString(),
        }),
      )

      // That fact opens a gap; the responsibility-needed route announces it.
      expect(outcome).toEqual({ status: 'applied' })
      expect(await settledAt(held.db, 'nobody-left')).toBeNull()
    })

    it('cancels the mail queued behind every notice it retired', async () => {
      await waiting('mail-first', 'reply.pending_approval')
      await waiting('mail-second', 'reply.pending_approval')

      await handleNotificationSettlementEvent(
        deps(),
        envelope('review.reply.approved', replyPayload),
      )

      expect(await queuedMail(held.db, 'mail-first')).toEqual(MAIL_CANCELLED)
      expect(await queuedMail(held.db, 'mail-second')).toEqual(MAIL_CANCELLED)
    })

    it('cancels no mail when the work was already settled', async () => {
      await seedNotice(held.db, {
        name: 'long-settled',
        organizationId: ORG,
        userId: 'recipient-long-settled',
        propertyId: PROPERTY,
        createdAt: OCCURRED_AT,
        type: 'reply.pending_approval',
        resourceType: 'inbox_item',
        resourceId: ITEM,
        resolvedAt: OCCURRED_AT,
      })

      await handleNotificationSettlementEvent(
        deps(),
        envelope('review.reply.approved', replyPayload),
      )

      expect(await settledAt(held.db, 'long-settled')).toEqual(OCCURRED_AT)
      expect(await queuedMail(held.db, 'long-settled')).toEqual(MAIL_QUEUED)
    })

    it('records an applied receipt under its own consumer name', async () => {
      const settling = deps()

      await handleNotificationSettlementEvent(
        settling,
        envelope('review.reply.approved', replyPayload),
      )

      expect(settling.receipts.insertReceipt).toHaveBeenCalledWith(
        '93000000-0000-4000-8000-0000000000aa',
        'notification.settle-on-review-reply-approved',
        'applied',
      )
    })

    it('settles nothing, and says so, when the reply has no Inbox item left', async () => {
      await waiting('no-item', 'reply.pending_approval')
      const settling = deps(null)

      const outcome = await handleNotificationSettlementEvent(
        settling,
        envelope('review.reply.approved', replyPayload),
      )

      expect(outcome).toEqual({ status: 'obsolete' })
      expect(await settledAt(held.db, 'no-item')).toBeNull()
      expect(settling.receipts.insertReceipt).toHaveBeenCalledWith(
        '93000000-0000-4000-8000-0000000000aa',
        'notification.settle-on-review-reply-approved',
        'obsolete',
      )
    })

    it('refuses a fact whose tenant disagrees with its envelope', async () => {
      await waiting('cross-tenant', 'reply.pending_approval')
      const crossTenant = {
        ...envelope('review.reply.approved', replyPayload),
        organizationId: 'organization-other',
      }

      await expect(
        handleNotificationSettlementEvent(deps(), crossTenant),
      ).rejects.toThrow(/attribution mismatch/)
      expect(await settledAt(held.db, 'cross-tenant')).toBeNull()
    })

    it('registers one consumer per settling fact', () => {
      const registry = createConsumerRegistry()

      registerNotificationSettlementConsumers(registry, deps())

      expect(
        registry
          .list()
          .filter((entry) => entry.consumerName.startsWith('notification.settle-'))
          .map((entry) => `${entry.eventType} ${entry.consumerName}`)
          .sort(),
      ).toEqual(
        NOTIFICATION_SETTLEMENT_CONSUMERS.map(
          (route) => `${route.eventType} ${route.consumerName}`,
        ).sort(),
      )
    })
  },
)
