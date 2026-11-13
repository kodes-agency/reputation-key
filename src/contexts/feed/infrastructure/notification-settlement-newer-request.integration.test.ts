// A settling fact handled late must not retire a newer request (N47 case 2).
//
// Settlement is keyed on (type, resource). A rejection whose consumer is
// retried after the author already resubmitted would otherwise settle the
// resubmission's approval request, which coalesced into the same row, and
// cancel the only email asking anybody to decide it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { inboxItemId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import type { NotificationType } from '../domain/notification-types'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { seedNotice } from './jobs/delivery-seed'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import {
  MAIL_CANCELLED,
  MAIL_QUEUED,
  queuedMail,
  settledAt,
  settlementDeps,
} from './notification-settlement-test-db'

const ORG = 'organization-newer-request'
const PROPERTY = propertyId('94000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('94000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('94000000-0000-4000-8000-000000000003')
const ACTOR = userId('actor-newer-request')
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:00:00.000Z')

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

describe.sequential(
  'a settling fact handled after the work was asked for again (real PostgreSQL)',
  () => {
    let held: HeldTransaction

    const approvalRequest = (name: string) =>
      seedNotice(held.db, {
        name,
        organizationId: ORG,
        userId: `approver-${name}`,
        propertyId: PROPERTY,
        createdAt: OCCURRED_AT,
        type: 'reply.pending_approval',
        resourceType: 'inbox_item',
        resourceId: ITEM,
      })

    const depsWhereStillWaiting = (stillWaiting: ReadonlyArray<NotificationType>) => {
      const deps = settlementDeps(held.db, { now: NOW, item: ITEM })
      deps.workState.finished.mockImplementation(async ({ types }) =>
        types.filter((type) => !stillWaiting.includes(type)),
      )
      return deps
    }

    beforeAll(async () => {
      registerAllEventSchemas()
      held = await holdTransaction()
      await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
    })

    afterAll(async () => {
      await held?.rollBack()
    })

    it('leaves the newer approval request waiting', async () => {
      await approvalRequest('resubmitted')
      const deps = depsWhereStillWaiting(['reply.pending_approval'])

      const outcome = await handleNotificationSettlementEvent(deps, rejected())

      expect(deps.workState.finished).toHaveBeenCalledWith({
        organizationId: ORG,
        resourceId: ITEM,
        types: ['reply.pending_approval'],
      })
      expect(await settledAt(held.db, 'resubmitted')).toBeNull()
      expect(await queuedMail(held.db, 'resubmitted')).toEqual(MAIL_QUEUED)
      // The rule ran and decided: nothing to retry.
      expect(outcome).toEqual({ status: 'applied' })
    })

    it('still settles once the request is really finished', async () => {
      await approvalRequest('finished')

      await handleNotificationSettlementEvent(depsWhereStillWaiting([]), rejected())

      expect(await settledAt(held.db, 'finished')).toEqual(NOW)
      expect(await queuedMail(held.db, 'finished')).toEqual(MAIL_CANCELLED)
    })
  },
)
