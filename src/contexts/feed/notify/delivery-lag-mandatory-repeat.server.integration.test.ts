import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications } from '#/shared/db/schema'
import { organizationId } from '#/shared/domain/ids'
import { seedOutboxEvents } from '#/shared/db/testing/outbox-event-fixture'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { readNotificationDeliveryLag } from './delivery-lag.server'
import { acceptance, clearOrganization } from './delivery-lag.test-fixtures'
import { mandatoryRepeatEmailKey } from './insert-notification.server'

// ── A mandatory repeat's email is timed from its own event ──────────────
//
// A second role change coalesces into the first one's unread row and anchors
// its email there, but that email exists because of the second event. Timed
// from the row's (first) event, it would read as minutes or days late and
// trip the five-minute acceptance alert on the day it went out on time.
const REPEAT_ORG = organizationId('notification-delivery-lag-repeat-org')
const REPEAT_USER = 'notification-delivery-lag-repeat-user'
const REPEAT_NOTIFICATION = '86000000-0000-4000-8000-000000000001'
const ROLE_EVENTS = {
  first: { id: '86000000-0000-4000-8000-000000000011', at: '2026-08-29T07:00:00.000Z' },
  accepted: {
    id: '86000000-0000-4000-8000-000000000012',
    at: '2026-08-29T07:30:00.000Z',
  },
  awaiting: {
    id: '86000000-0000-4000-8000-000000000013',
    at: '2026-08-29T07:40:00.000Z',
  },
} as const

describe.sequential(
  'notification delivery lag for mandatory repeats (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const clearScope = async () => {
      await clearOrganization(db, REPEAT_ORG)
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      await clearScope()
      await seedOutboxEvents(
        db,
        Object.values(ROLE_EVENTS).map((event) => ({
          id: event.id,
          eventType: 'identity.member.role_changed',
          organizationId: REPEAT_ORG,
          sourceContext: 'identity',
          sourceAggregateId: REPEAT_USER,
          at: new Date(event.at),
          payload: { memberUserId: REPEAT_USER },
        })),
      )
      await db.insert(notifications).values({
        id: REPEAT_NOTIFICATION,
        userId: REPEAT_USER,
        organizationId: REPEAT_ORG,
        propertyId: null,
        type: 'account.organization_role_changed',
        category: 'mandatory',
        priority: 'normal',
        status: 'unread',
        resourceType: 'organization',
        resourceId: REPEAT_ORG,
        eventId: ROLE_EVENTS.first.id,
        title: 'Role changed',
        payload: {},
        coalescedCount: 3,
        createdAt: new Date(ROLE_EVENTS.first.at),
        updatedAt: new Date(ROLE_EVENTS.awaiting.at),
      })
      const email = (
        id: string,
        idempotencyKey: string,
        createdAt: string,
        acceptedAt: string | null,
      ) => ({
        id,
        notificationId: REPEAT_NOTIFICATION,
        userId: REPEAT_USER,
        organizationId: REPEAT_ORG,
        propertyId: null,
        category: 'mandatory',
        cadence: 'immediate',
        status: acceptedAt === null ? 'pending' : 'accepted',
        priority: 'normal',
        idempotencyKey,
        attemptedAt: acceptedAt === null ? null : new Date(acceptedAt),
        acceptedAt: acceptedAt === null ? null : new Date(acceptedAt),
        createdAt: new Date(createdAt),
        updatedAt: new Date(acceptedAt ?? createdAt),
      })
      await db.insert(notificationEmailQueue).values([
        // The row's own email, for the event that created it: 30 s.
        email(
          '86000000-0000-4000-9000-000000000001',
          `${REPEAT_NOTIFICATION}:email`,
          '2026-08-29T07:00:05.000Z',
          '2026-08-29T07:00:30.000Z',
        ),
        // The second role change's email: 60 s from its own event.
        email(
          '86000000-0000-4000-9000-000000000002',
          mandatoryRepeatEmailKey(ROLE_EVENTS.accepted.id, REPEAT_USER),
          '2026-08-29T07:30:05.000Z',
          '2026-08-29T07:31:00.000Z',
        ),
        // The third one's email is still waiting on the provider.
        email(
          '86000000-0000-4000-9000-000000000003',
          mandatoryRepeatEmailKey(ROLE_EVENTS.awaiting.id, REPEAT_USER),
          '2026-08-29T07:40:05.000Z',
          null,
        ),
      ])
    })

    afterAll(async () => {
      if (db) await clearScope()
      await lease?.release()
    })

    it('measures each repeat email from the event that queued it', async () => {
      const report = await readNotificationDeliveryLag(db, () => true, {
        recordedAtOrAfter: new Date('2026-08-29T06:00:00.000Z'),
        recordedBefore: new Date('2026-08-29T08:00:00.000Z'),
        scanLimit: 10,
        statementTimeoutMs: 2_000,
      })

      expect(report.immediateEmailAcceptance).toEqual(
        acceptance({
          awaitingProviderAcceptance: 1,
          oldestAwaitingSourceRecordedAt: new Date(ROLE_EVENTS.awaiting.at),
          acceptedLatencyP99Ms: 60_000,
          acceptedSampleCount: 2,
        }),
      )
    })
  },
)
