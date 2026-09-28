// A send the provider accepted after its row was retired mid-flight, against
// the real database.
//
// Settlement cancels, and a bounce cascade suppresses, every still-sendable
// row — including one whose provider call is already under way. The provider
// then accepts and delivers the mail, and the acceptance used to match no row:
// the message id was lost, so a later bounce or complaint for that message
// could not be traced to its recipient and no suppression was written.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications, properties } from '#/shared/db/schema'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotification } from '../../domain/notification-constructors'
import { SETTLED_EMAIL_REASON } from '../../domain/notification-settlement'
import { createNotificationRepository } from './notification.repository'
import { createNotificationEmailRepository } from './notification-email.repository'

const ORG = organizationId('notification-accepted-mid-flight-org')
const PROPERTY = propertyId('88000000-0000-4000-8000-000000000001')
const NOTICE = '88000000-0000-4000-8000-000000000002'
const EMAIL = '88000000-0000-4000-8000-000000000003'
const APPROVER = userId('notification-accepted-mid-flight-approver')
const STARTED_AT = new Date('2026-09-23T23:00:00.000Z')
const SETTLED_AT = new Date('2026-09-23T23:00:01.000Z')
const ACCEPTED_AT = new Date('2026-09-23T23:00:02.000Z')
const MESSAGE = 'resend-message-accepted-mid-flight'

describe.sequential('an acceptance that lands on a retired row (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clearRows = async () => {
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearRows()
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Mid-flight Hotel',
      slug: 'notification-accepted-mid-flight',
      timezone: 'UTC',
    })
  })

  beforeEach(async () => {
    await clearRows()
    const built = createNotification(
      {
        id: notificationId(NOTICE),
        userId: APPROVER,
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.pending_approval',
        resourceType: 'inbox_item',
        resourceId: '88000000-0000-4000-8000-000000000004',
        eventId: 'accepted-mid-flight',
      },
      () => STARTED_AT,
    )
    if (built.isErr()) throw built.error
    await createNotificationRepository(db).insert(built.value)
    await db.insert(notificationEmailQueue).values({
      id: EMAIL,
      notificationId: NOTICE,
      userId: APPROVER as string,
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      category: 'urgent_operational',
      cadence: 'immediate',
      status: 'pending',
      priority: 'urgent',
      idempotencyKey: `${NOTICE}:email`,
    })
  })

  afterAll(async () => {
    if (db) {
      await clearRows()
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }
    await lease?.release()
  })

  const settle = (emails: ReturnType<typeof createNotificationEmailRepository>) =>
    emails.cancelQueuedForNotifications(
      [notificationId(NOTICE)],
      ORG,
      SETTLED_EMAIL_REASON,
      SETTLED_AT,
    )

  it('keeps the message id of a send cancelled while the provider call ran', async () => {
    const emails = createNotificationEmailRepository(db)
    await emails.markAttemptStarted(EMAIL, ORG, PROPERTY, STARTED_AT)
    await settle(emails)

    await emails.markAccepted(EMAIL, ORG, PROPERTY, MESSAGE, ACCEPTED_AT)

    const stored = await emails.findById(notificationEmailId(EMAIL), ORG, PROPERTY)
    expect(stored).toMatchObject({
      status: 'cancelled',
      suppressionReason: SETTLED_EMAIL_REASON,
      providerMessageId: MESSAGE,
      providerState: 'accepted',
      acceptedAt: ACCEPTED_AT,
    })
    // What a bounce or complaint webhook reads to suppress the address.
    expect(await emails.findProviderMessageRecipients(MESSAGE)).toHaveLength(1)
  })

  it('records nothing on a row that was retired before any attempt began', async () => {
    const emails = createNotificationEmailRepository(db)
    await settle(emails)

    await emails.markAccepted(EMAIL, ORG, PROPERTY, MESSAGE, ACCEPTED_AT)

    const stored = await emails.findById(notificationEmailId(EMAIL), ORG, PROPERTY)
    expect(stored).toMatchObject({ status: 'cancelled', providerMessageId: null })
  })
})
