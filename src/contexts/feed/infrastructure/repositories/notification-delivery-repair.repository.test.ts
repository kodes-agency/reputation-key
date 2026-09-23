// Feed notification surface — the durable-delivery repair read against
// PostgreSQL.
//
// Only a real database proves the rule the repair rests on: a delivery Redis
// accepted and nobody settled is offered, and nothing else is — not a
// delivery that settled without a notification because its recipient muted
// the type or no longer qualified, not one still inside its grace edge.
//
// The read spans every tenant, so the fixtures live in a 2032 window no other
// suite writes into.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema'
import { organizationId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotificationDeliveryRepairRepository } from './notification-delivery-repair.repository'

const ORG = organizationId('notification-delivery-repair-org')
const PROPERTY = '87000000-0000-4000-8000-000000000001'
const ASSIGNED = '87000000-0000-4000-8000-000000000002'
const MUTED = '87000000-0000-4000-8000-000000000003'
const DECLINED = '87000000-0000-4000-8000-000000000004'
const FRESH = '87000000-0000-4000-8000-000000000005'
const EXPIRED = '87000000-0000-4000-8000-000000000006'
const UNROUTED = '87000000-0000-4000-8000-000000000008'
const SECOND = '87000000-0000-4000-8000-000000000009'
const ROUTE = 'notification.on-inbox-inbox_item-assigned'

const WINDOW = {
  recordedAtOrAfter: new Date('2032-05-01T00:00:00.000Z'),
  enqueuedBefore: new Date('2032-05-01T11:55:00.000Z'),
}
const RECORDED = new Date('2032-05-01T10:00:00.000Z')
const ENQUEUED = new Date('2032-05-01T10:00:01.000Z')

describe.sequential('notification delivery repair read (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const cleanUp = async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(cleanUp)

  afterAll(async () => {
    await cleanUp()
    await lease?.release()
  })

  const repository = () => createNotificationDeliveryRepairRepository(db)

  /** One assignment fact, recorded at `recordedAt`. */
  async function seedFact(
    id: string,
    options: Readonly<{ recordedAt?: Date; eventType?: string }> = {},
  ): Promise<void> {
    await db.insert(outboxEvents).values({
      id,
      eventType: options.eventType ?? 'inbox.inbox_item.assigned',
      eventVersion: 1,
      payload: { inboxItemId: '87000000-0000-4000-8000-000000000020' },
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: 'inbox',
      sourceAggregateId: '87000000-0000-4000-8000-000000000020',
      createdAt: options.recordedAt ?? RECORDED,
      publishedAt: options.recordedAt ?? RECORDED,
    })
  }

  /** The bridge's enqueue receipt, and optionally the settlement's claim. */
  async function seedDelivery(
    eventId: string,
    options: Readonly<{
      settled?: 'applied' | 'obsolete'
      enqueuedAt?: Date
      route?: string
    }> = {},
  ): Promise<void> {
    const route = options.route ?? ROUTE
    await db.insert(eventConsumerReceipts).values({
      eventId,
      consumerName: `notification.enqueue:${route}:delivery-1`,
      status: 'applied',
      createdAt: options.enqueuedAt ?? ENQUEUED,
    })
    if (options.settled) {
      await db.insert(eventConsumerReceipts).values({
        eventId,
        consumerName: `notification.materialized:${route}:delivery-1`,
        status: options.settled,
      })
    }
  }

  it('offers a delivery Redis accepted that never settled, as the relay delivers its fact', async () => {
    await seedFact(ASSIGNED)
    await seedDelivery(ASSIGNED)

    const offered = await repository().findUnsettledDeliveries({
      ...WINDOW,
      cursor: null,
      limit: 10,
    })

    expect(offered).toEqual([
      {
        event: {
          id: ASSIGNED,
          eventType: 'inbox.inbox_item.assigned',
          eventVersion: 1,
          payload: { inboxItemId: '87000000-0000-4000-8000-000000000020' },
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceContext: 'inbox',
          sourceAggregateId: '87000000-0000-4000-8000-000000000020',
          recordedAt: RECORDED,
        },
        consumerName: ROUTE,
      },
    ])
  })

  it('never offers a delivery that settled without a notification', async () => {
    await seedFact(MUTED)
    await seedDelivery(MUTED, { settled: 'applied' })
    await seedFact(DECLINED)
    await seedDelivery(DECLINED, { settled: 'obsolete' })

    await expect(
      repository().findUnsettledDeliveries({ ...WINDOW, cursor: null, limit: 10 }),
    ).resolves.toEqual([])
  })

  it('offers nothing still settling, too old, or outside the beta routes', async () => {
    await seedFact(FRESH)
    await seedDelivery(FRESH, { enqueuedAt: WINDOW.enqueuedBefore })
    await seedFact(EXPIRED, { recordedAt: new Date('2032-04-30T23:59:59.999Z') })
    await seedDelivery(EXPIRED)
    await seedFact(UNROUTED, { eventType: 'metric.corrected' })
    await seedDelivery(UNROUTED)

    await expect(
      repository().findUnsettledDeliveries({ ...WINDOW, cursor: null, limit: 10 }),
    ).resolves.toEqual([])
  })

  it('pages by (recorded_at, id, route) without skipping or repeating a delivery', async () => {
    await seedFact(ASSIGNED)
    await seedDelivery(ASSIGNED)
    await seedFact(SECOND, { recordedAt: new Date('2032-05-01T10:30:00.000Z') })
    await seedDelivery(SECOND)

    const first = await repository().findUnsettledDeliveries({
      ...WINDOW,
      cursor: null,
      limit: 1,
    })
    const next = await repository().findUnsettledDeliveries({
      ...WINDOW,
      cursor: {
        recordedAt: first[0]!.event.recordedAt,
        eventId: first[0]!.event.id,
        consumerName: first[0]!.consumerName,
      },
      limit: 1,
    })

    expect(first.map((delivery) => delivery.event.id)).toEqual([ASSIGNED])
    expect(next.map((delivery) => delivery.event.id)).toEqual([SECOND])
  })
})
