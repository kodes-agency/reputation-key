// Feed notification surface — an Inbox item whose notice is never delivered
// pages through the delivery-lag alert, read from PostgreSQL.
//
// A consumer writes its notice in the transaction that claims its receipt, so
// a notice that was never delivered is an arrival fact with no receipt. The
// delivery-lag read counts exactly that, and the in-app alert pages on it.
// The fixtures live in a created_at window no other suite writes into.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { ALERT_DEFINITIONS } from '#/shared/observability/alert-definitions'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import { createNotificationDeliveryLagRepository } from './notification-delivery-lag.repository'

const ORG = organizationId('f3a20000-0000-4000-8000-000000000001')
const OTHER_ORG = organizationId('f3a20000-0000-4000-8000-000000000002')
const PROPERTY = 'f3a20000-0000-4000-8000-000000000010'
const LATE_ITEM = 'f3a20000-0000-4000-8000-000000000020'
const DELIVERED_ITEM = 'f3a20000-0000-4000-8000-000000000030'

const WINDOW = {
  recordedAtOrAfter: new Date('2019-03-08T05:00:00.000Z'),
  recordedBefore: new Date('2019-03-08T06:00:00.000Z'),
  scanLimit: 1000,
  statementTimeoutMs: 2_000,
}
const ARRIVED_AT = new Date('2019-03-08T05:10:00.000Z')
const ARRIVAL_CONSUMER = 'notification.on-inbox-item-created'
const ARRIVAL_EVENT = 'inbox.inbox_item.created'

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['outbox_events', 'inbox_items', 'properties'],
})

async function seedFeedbackItemWithArrivalFact(item: string): Promise<string> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        created_at, updated_at)
     VALUES ($1, $2, $3, 'feedback', $4, $5, $5, $5)`,
    [item, ORG, PROPERTY, randomUUID(), ARRIVED_AT],
  )
  const event = randomUUID()
  await pool.query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at, published_at)
     VALUES ($1, $2, 1, '{}', $3, $4, 'inbox', $5, $6, $6)`,
    [event, ARRIVAL_EVENT, ORG, PROPERTY, item, ARRIVED_AT],
  )
  return event
}

async function seedProperty(): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Delivery Property', $3, 'UTC', 0)`,
    [PROPERTY, ORG, `property-${PROPERTY}`],
  )
}

/** The alert's verdict on what the real lag read finds in the window. */
async function inAppDeliveryLagAlert() {
  const lagRepository = createNotificationDeliveryLagRepository(
    drizzle(getPool()) as unknown as Database,
    () => true,
  )
  const checker = createHealthChecker(
    drizzle(getPool()) as unknown as Database,
    undefined,
    {
      readNotificationDeliveryLag: () => lagRepository.read(WINDOW),
    },
  )
  const deliveryLag = await checker.signals.notificationDeliveryLag()
  const definition = ALERT_DEFINITIONS.find(
    (alert) => alert.name === 'notification.in-app-delivery-lag',
  )
  expect(definition?.evaluate).not.toBeNull()
  return {
    deliveryLag,
    event: definition!.evaluate!(
      { notifications: { deliveryLag } } as unknown as OperationsSnapshot,
      {} as never,
    ),
  }
}

describe('an Inbox item whose notice was never delivered', () => {
  it('pages the in-app delivery-lag alert while its arrival fact has no receipt', async () => {
    await seedProperty()
    await seedFeedbackItemWithArrivalFact(LATE_ITEM)

    const { deliveryLag, event } = await inAppDeliveryLagAlert()

    expect(deliveryLag.sourceReceiptPendingByEventType).toEqual({
      [ARRIVAL_EVENT]: 1,
    })
    expect(event).toMatchObject({ severity: 'P1' })
  })

  it('stays quiet once the consumer applied its receipt', async () => {
    await seedProperty()
    const event = await seedFeedbackItemWithArrivalFact(DELIVERED_ITEM)
    await getPool().query(
      `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
       VALUES ($1, $2, 'applied')`,
      [event, ARRIVAL_CONSUMER],
    )

    const { deliveryLag, event: alertEvent } = await inAppDeliveryLagAlert()

    expect(deliveryLag.sourceReceiptPending).toBe(0)
    expect(alertEvent).toBeNull()
  })
})
