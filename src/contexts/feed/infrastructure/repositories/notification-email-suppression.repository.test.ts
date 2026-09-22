// Durable, address-keyed email suppression against real PostgreSQL: a bounce or
// complaint must outlive the queue rows that proved it, follow the address
// rather than the user, and never be inferred from a transient bounce.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications, properties } from '#/shared/db/schema'
import { notificationEmailId, organizationId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { applyResendEvent } from '../handlers/resend-event-handler'
import { createFakeJobLogger } from '../jobs/test-fixtures'
import { createNotificationEmailRepository } from './notification-email.repository'

const ORG = organizationId('notification-email-suppression-org')
const USER = userId('notification-email-suppression-user')
const PROPERTY = '84000000-0000-4000-8000-000000000001'
const NOTIFICATION = '84000000-0000-4000-8000-000000000002'
const EMAIL = notificationEmailId('84000000-0000-4000-8000-000000000003')
const ADDRESS = 'suppression-test@example.com'
const NOW = new Date('2026-08-25T08:00:00.000Z')
const LATER = new Date('2026-08-25T08:05:00.000Z')

describe.sequential('durable email suppression (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const forgetAddress = () =>
    lease.pool.query(
      `DELETE FROM notification_email_suppressions
        WHERE address_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [ADDRESS],
    )

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
    await forgetAddress()
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Suppression Test Property',
      slug: 'notification-email-suppression-test',
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
      resourceId: 'suppression-test-item',
      eventId: 'suppression-test-event',
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
      idempotencyKey: 'suppression-test-queue',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  afterAll(async () => {
    if (db) {
      await forgetAddress()
      await db.delete(notifications).where(eq(notifications.organizationId, ORG))
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }
    await lease?.release()
  })

  /** A provider event for the message the queue row was accepted as. */
  const deliverEvent = async (type: string, bounceType?: string) => {
    const repo = createNotificationEmailRepository(db)
    await repo.markAccepted(EMAIL, ORG, PROPERTY, 'resend-suppression-1', NOW)
    await applyResendEvent(
      {
        emailRepo: repo,
        // How the address might come back from the identity store.
        userLookup: { getEmail: async () => ` ${ADDRESS.toUpperCase()}` },
        logger: createFakeJobLogger(),
      },
      {
        type,
        providerMessageId: 'resend-suppression-1',
        occurredAt: LATER,
        eventId: 'msg_suppression',
        ...(bounceType === undefined ? {} : { bounceType }),
      },
    )
    return repo
  }

  it('still refuses a hard-bounced address after retention deleted the rows that proved it', async () => {
    const repo = await deliverEvent('email.bounced', 'Permanent')

    // The 90-day sweep deletes terminal queue rows; the next notice is new.
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))

    await expect(repo.isAddressSuppressed(ADDRESS)).resolves.toBe(true)
  })

  it('writes a complaint the first delivery lost once the provider retries it', async () => {
    const repo = createNotificationEmailRepository(db)
    await repo.markAccepted(EMAIL, ORG, PROPERTY, 'resend-suppression-1', NOW)
    const event = {
      type: 'email.complained',
      providerMessageId: 'resend-suppression-1',
      occurredAt: LATER,
      eventId: 'msg_suppression',
    }
    // The status change commits; the suppression write after it fails.
    await expect(
      applyResendEvent(
        {
          emailRepo: repo,
          userLookup: {
            getEmail: async () => {
              throw new Error('identity store unavailable')
            },
          },
          logger: createFakeJobLogger(),
        },
        event,
      ),
    ).rejects.toThrow('identity store unavailable')

    await applyResendEvent(
      {
        emailRepo: repo,
        userLookup: { getEmail: async () => ADDRESS },
        logger: createFakeJobLogger(),
      },
      event,
    )

    await expect(repo.isAddressSuppressed(ADDRESS)).resolves.toBe(true)
  })

  it('keeps a spam complaint as durably as a hard bounce', async () => {
    const repo = await deliverEvent('email.complained')

    await expect(repo.isAddressSuppressed(ADDRESS)).resolves.toBe(true)
  })

  it('leaves the address mailable after a transient bounce', async () => {
    const repo = await deliverEvent('email.bounced', 'Transient')

    await expect(repo.isAddressSuppressed(ADDRESS)).resolves.toBe(false)
  })

  it('follows the address, not the user: a different address is not refused', async () => {
    const repo = await deliverEvent('email.bounced', 'Permanent')

    await expect(repo.isAddressSuppressed('new-address@example.com')).resolves.toBe(false)
  })

  it('never counts a local suppression as the provider refusing the address', async () => {
    const repo = createNotificationEmailRepository(db)

    await repo.markSuppressed(EMAIL, ORG, PROPERTY, 'preference_disabled', NOW)

    await expect(repo.isAddressSuppressed(ADDRESS)).resolves.toBe(false)
  })

  it('stores a digest of the address, never the address itself', async () => {
    await deliverEvent('email.bounced', 'Permanent')

    const rows = await db.execute(sql`SELECT * FROM notification_email_suppressions`)

    expect(JSON.stringify(rows.rows)).not.toContain('@')
    expect(JSON.stringify(rows.rows)).not.toContain('suppression-test')
  })
})
