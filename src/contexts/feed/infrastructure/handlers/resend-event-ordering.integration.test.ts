// Provider events against real PostgreSQL: they are applied in the order they
// happened, and a delivery the provider repeats is applied once.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationEmailQueue,
  notifications,
  properties,
  resendWebhookDeliveries,
} from '#/shared/db/schema'
import { notificationEmailId, organizationId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createFakeJobLogger } from '../jobs/test-fixtures'
import { markNotificationEmailAccepted } from '../../email/notification-email-queue.server'
import {
  forgetEmailAddress,
  isEmailAddressSuppressed,
} from '../../email/notification-email-suppression.server'
import { createResendEventHandler, type ResendEventInput } from './resend-event-handler'

const ORG = organizationId('resend-event-ordering-org')
const USER = userId('resend-event-ordering-user')
const PROPERTY = '85000000-0000-4000-8000-000000000001'
const NOTIFICATION = '85000000-0000-4000-8000-000000000002'
const EMAIL = notificationEmailId('85000000-0000-4000-8000-000000000003')
const ADDRESS = 'resend-event-ordering@example.com'
const ADDRESS_KEY = 'resend-event-ordering-test-key-000000001'
const PROVIDER_ID = 'resend-event-ordering-1'
const ACCEPTED = new Date('2026-08-25T08:00:00.000Z')
const BOUNCED = new Date('2026-08-25T08:05:00.000Z')
const REMOVED = new Date('2026-08-25T08:10:00.000Z')
const DELIVERY_IDS = ['order_bounce', 'order_removed', 'order_stale_add', 'order_repeat']

describe.sequential('provider event ordering (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const emailAddressKeys = { emailAddressKey: ADDRESS_KEY }
  const forgetAddress = () => forgetEmailAddress(db, emailAddressKeys, ADDRESS)
  const isAddressSuppressed = () =>
    isEmailAddressSuppressed(db, emailAddressKeys, ADDRESS)
  const handle = createResendEventHandler
  const deps = () => ({
    db,
    emailAddressKeys,
    userLookup: { getEmail: async () => ADDRESS },
    logger: createFakeJobLogger(),
  })

  const clean = async () => {
    await forgetAddress()
    await db
      .delete(resendWebhookDeliveries)
      .where(inArray(resendWebhookDeliveries.eventId, DELIVERY_IDS))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  const bounce = (eventId: string, occurredAt: Date): ResendEventInput => ({
    type: 'email.bounced',
    providerMessageId: PROVIDER_ID,
    occurredAt,
    eventId,
    bounceType: 'Permanent',
  })
  const removal = (eventId: string, occurredAt: Date): ResendEventInput => ({
    type: 'suppression.removed',
    address: ADDRESS,
    occurredAt,
    eventId,
  })

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
    await clean()
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Resend Ordering Property',
      slug: 'resend-event-ordering',
      timezone: 'UTC',
    })
    await db.insert(notifications).values({
      id: NOTIFICATION,
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'review.created',
      category: 'urgent_operational',
      resourceType: 'inbox_item',
      resourceId: 'resend-event-ordering-item',
      eventId: 'resend-event-ordering-event',
      title: 'New review',
      payload: {},
    })
    await db.insert(notificationEmailQueue).values({
      id: EMAIL,
      notificationId: NOTIFICATION,
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      category: 'urgent_operational',
      cadence: 'immediate',
      idempotencyKey: 'resend-event-ordering-queue',
      createdAt: ACCEPTED,
      updatedAt: ACCEPTED,
    })
    await markNotificationEmailAccepted(db, EMAIL, ORG, PROPERTY, PROVIDER_ID, ACCEPTED)
  })

  afterAll(async () => {
    if (db) await clean()
    await lease?.release()
  })

  it('does not suppress the address again for a bounce that happened before its removal', async () => {
    const handler = handle(deps())
    await handler(removal('order_removed', REMOVED))

    const stale = await handler(bounce('order_bounce', BOUNCED))

    expect(stale.suppressed).toBe(0)
    await expect(isAddressSuppressed()).resolves.toBe(false)
  })

  it('does not record a provider suppression that happened before the removal', async () => {
    const handler = handle(deps())
    await handler(removal('order_removed', REMOVED))

    const result = await handler({
      type: 'suppression.added',
      address: ADDRESS,
      origin: 'bounce',
      occurredAt: BOUNCED,
      eventId: 'order_stale_add',
    })

    expect(result).toMatchObject({ applied: false, reason: 'out_of_order' })
    await expect(isAddressSuppressed()).resolves.toBe(false)
  })

  it('suppresses the address for a bounce that happened after the removal', async () => {
    const handler = handle(deps())
    await handler(removal('order_removed', BOUNCED))

    await handler(bounce('order_bounce', REMOVED))

    await expect(isAddressSuppressed()).resolves.toBe(true)
  })

  it('keeps a refusal that is newer than a removal arriving late', async () => {
    const handler = handle(deps())
    await handler(bounce('order_bounce', REMOVED))

    await handler(removal('order_removed', BOUNCED))

    await expect(isAddressSuppressed()).resolves.toBe(true)
  })

  it('applies a repeated delivery once', async () => {
    const handler = handle(deps())
    const first = await handler(bounce('order_repeat', BOUNCED))
    // The operator lifts the refusal; the provider then repeats the delivery.
    await forgetAddress()

    const repeat = await handler(bounce('order_repeat', BOUNCED))

    expect(first.applied).toBe(true)
    expect(repeat).toEqual({
      applied: false,
      rows: 0,
      suppressed: 0,
      reason: 'duplicate_delivery',
    })
    await expect(isAddressSuppressed()).resolves.toBe(false)
  })

  it('applies the retry of a delivery that failed before it was remembered', async () => {
    const failing = handle({
      ...deps(),
      userLookup: {
        getEmail: async () => {
          throw new Error('identity store unavailable')
        },
      },
    })
    await expect(failing(bounce('order_repeat', BOUNCED))).rejects.toThrow(
      'identity store unavailable',
    )

    await handle(deps())(bounce('order_repeat', BOUNCED))

    await expect(isAddressSuppressed()).resolves.toBe(true)
  })
})
