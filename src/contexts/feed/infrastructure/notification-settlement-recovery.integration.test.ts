// "Reconnect Google" and "Guest portal needs attention" once the problem is
// gone (N24).
//
// Neither type ever settled. A reconnect by another admin left every other
// admin's "Reconnect Google" unread and its deferred email still went out at
// 07:00; a Portal whose Health recovered still appeared in the next morning's
// digest as "Its Google review destination is gone … Choose another".

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { propertyId } from '#/shared/domain/ids'
import { isStillActionable } from '../domain/notification-actionable'
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

const ORG = 'organization-recovery'
const PROPERTY = propertyId('97000000-0000-4000-8000-000000000001')
const PORTAL = '97000000-0000-4000-8000-000000000006'
const CONNECTION = '97000000-0000-4000-8000-000000000008'
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:30:00.000Z')

const googleFact = (
  eventType: string,
  eventVersion: number,
  payload: Record<string, unknown>,
): ConsumerEvent => ({
  eventId: '97000000-0000-4000-8000-0000000000aa',
  eventType,
  eventVersion,
  payload: { connectionId: CONNECTION, organizationId: ORG, ...payload },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: CONNECTION,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

const health = (status: string, reason: string): ConsumerEvent => ({
  eventId: '97000000-0000-4000-8000-0000000000bb',
  eventType: 'portal.health.changed',
  eventVersion: 1,
  payload: {
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: PROPERTY,
    previousStatus: 'degraded',
    previousReason: 'google_destination_unavailable',
    status,
    reason,
    sourceVersion: 'health-fence-2',
    occurredAt: OCCURRED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'portal',
  sourceAggregateId: PROPERTY,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

describe.sequential('notices whose problem is gone (real PostgreSQL)', () => {
  let held: HeldTransaction

  const reconnectRequest = (name: string) =>
    seedNotice(held.db, {
      name,
      organizationId: ORG,
      userId: `admin-${name}`,
      propertyId: PROPERTY,
      createdAt: OCCURRED_AT,
      type: 'integration.reauthorization_required',
      resourceType: 'integration',
      resourceId: CONNECTION,
    })

  const healthNotice = (name: string) =>
    seedNotice(held.db, {
      name,
      organizationId: ORG,
      userId: `manager-${name}`,
      propertyId: PROPERTY,
      createdAt: OCCURRED_AT,
      type: 'portal.health_attention',
      resourceType: 'portal',
      resourceId: PORTAL,
    })

  beforeAll(async () => {
    registerAllEventSchemas()
    held = await holdTransaction()
    await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  describe('a Google connection that works again', () => {
    it('retires every admin’s "Reconnect Google" once it is reconnected', async () => {
      await reconnectRequest('reconnected-a')
      await reconnectRequest('reconnected-b')

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        googleFact('integration.google_account.connected', 3, { userId: 'admin-b' }),
      )

      for (const name of ['reconnected-a', 'reconnected-b']) {
        expect(await settledAt(held.db, name)).toEqual(NOW)
        expect(await queuedMail(held.db, name)).toEqual(MAIL_CANCELLED)
      }
    })

    it('retires it too when an admin disconnects instead', async () => {
      await reconnectRequest('disconnected')

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        googleFact('integration.google_account.disconnected', 1, { userId: 'admin-b' }),
      )

      expect(await settledAt(held.db, 'disconnected')).toEqual(NOW)
    })
  })

  describe('a Portal whose Health no longer needs a person', () => {
    it('retires "Guest portal needs attention" once Health recovers', async () => {
      await healthNotice('recovered')

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        health('healthy', 'operational'),
      )

      expect(await settledAt(held.db, 'recovered')).toEqual(NOW)
    })

    it('retires it when the Portal moves to a state nobody has to fix', async () => {
      await healthNotice('disabled-publication')

      await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        health('unavailable', 'publication_disabled'),
      )

      expect(await settledAt(held.db, 'disabled-publication')).toEqual(NOW)
    })

    it('leaves it waiting while Health still asks for a person', async () => {
      await healthNotice('still-degraded')

      const outcome = await handleNotificationSettlementEvent(
        settlementDeps(held.db, { now: NOW }),
        health('degraded', 'public_address_unavailable'),
      )

      expect(await settledAt(held.db, 'still-degraded')).toBeNull()
      expect(await queuedMail(held.db, 'still-degraded')).toEqual(MAIL_QUEUED)
      expect(outcome).toEqual({ status: 'applied' })
    })
  })

  it('holds back the email of a settled reconnect or Health notice', () => {
    const settled = { status: 'unread' as const, readAt: null, resolvedAt: NOW }

    expect(
      isStillActionable({ ...settled, type: 'integration.reauthorization_required' }),
    ).toBe(false)
    expect(isStillActionable({ ...settled, type: 'portal.health_attention' })).toBe(false)
  })
})
