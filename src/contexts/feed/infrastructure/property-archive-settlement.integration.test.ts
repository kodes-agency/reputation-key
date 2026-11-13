// Archiving a Property finishes every notice on it that still asked for work,
// and cancels the mail queued behind them. The approvers an archive asks again
// are pinned in property-archive-notices.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { propertyId } from '#/shared/domain/ids'
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

const ORG = 'organization-property-archive'
const PROPERTY = propertyId('30000000-0000-4000-8000-0000000000c3')
const OTHER_PROPERTY = propertyId('30000000-0000-4000-8000-0000000000c4')
const ADMIN = 'admin-property-archive'
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-24T06:00:00.000Z')

const archived = (): ConsumerEvent => ({
  eventId: '30000000-0000-4000-8000-0000000000aa',
  eventType: 'property.archived',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: PROPERTY,
    occurredAt: OCCURRED_AT.toISOString(),
    userId: ADMIN,
    previousState: 'active',
    sourceEpoch: 1,
    recoveryDeadline: '2026-10-24T07:00:00.000Z',
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'property',
  sourceAggregateId: PROPERTY,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

describe.sequential(
  'the notices still asking for work on an archived Property (real PostgreSQL)',
  () => {
    let held: HeldTransaction

    const notice = (
      name: string,
      type: string,
      options: Readonly<{ propertyId?: string | null; resourceType?: string }> = {},
    ) =>
      seedNotice(held.db, {
        name,
        organizationId: ORG,
        userId: `recipient-${name}`,
        propertyId: options.propertyId === undefined ? PROPERTY : options.propertyId,
        createdAt: OCCURRED_AT,
        type,
        resourceType: options.resourceType ?? 'inbox_item',
        resourceId: `resource-${name}`,
      })

    beforeAll(async () => {
      registerAllEventSchemas()
      held = await holdTransaction()
      await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
      await seedProperty(held.db, { id: OTHER_PROPERTY, organizationId: ORG })
    })

    afterAll(async () => {
      await held?.rollBack()
    })

    it('are settled, all of them, and their mail cancelled', async () => {
      await notice('approval', 'reply.pending_approval')
      await notice('escalation', 'inbox.escalated')
      await notice('arrival', 'review.created')
      const deps = settlementDeps(held.db, { now: NOW, item: null })

      await handleNotificationSettlementEvent(deps, archived())

      for (const name of ['approval', 'escalation', 'arrival']) {
        expect(await settledAt(held.db, name)).toEqual(NOW)
        expect(await queuedMail(held.db, name)).toEqual(MAIL_CANCELLED)
      }
    })

    it('leaves another Property’s notices alone', async () => {
      await notice('elsewhere', 'reply.pending_approval', { propertyId: OTHER_PROPERTY })

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW, item: null }),
        archived(),
      )

      expect(await settledAt(held.db, 'elsewhere')).toBeNull()
      expect(await queuedMail(held.db, 'elsewhere')).toEqual(MAIL_QUEUED)
    })

    it('does not answer the Organization’s Google connection notice', async () => {
      // The connection is the Organization's; the Property only anchored its
      // notice, so archiving it answers nothing.
      await notice('reconnect', 'integration.reauthorization_required', {
        resourceType: 'integration',
      })

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW, item: null }),
        archived(),
      )

      expect(await settledAt(held.db, 'reconnect')).toBeNull()
    })
  },
)
