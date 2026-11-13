// Durable, address-keyed email suppression against real PostgreSQL: a bounce or
// complaint must outlive the queue rows that proved it, follow the address
// rather than the user, and never be inferred from a transient bounce.

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications, properties } from '#/shared/db/schema'
import { notificationEmailId, organizationId, userId } from '#/shared/domain/ids'
import type { EmailAddressKeys } from '../../domain/notification-email-queue-types'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  forgetEmailAddress,
  isEmailAddressSuppressed,
} from '../../email/notification-email-suppression.server'
import {
  markNotificationEmailAccepted,
  markNotificationEmailSuppressed,
} from '../../email/notification-email-queue.server'
import { applyResendEvent } from '../handlers/resend-event-handler'
import { createFakeJobLogger } from '../jobs/test-fixtures'

const ORG = organizationId('notification-email-suppression-org')
const USER = userId('notification-email-suppression-user')
const PROPERTY = '84000000-0000-4000-8000-000000000001'
const NOTIFICATION = '84000000-0000-4000-8000-000000000002'
const EMAIL = notificationEmailId('84000000-0000-4000-8000-000000000003')
const ADDRESS = 'suppression-test@example.com'
const NOW = new Date('2026-08-25T08:00:00.000Z')
const LATER = new Date('2026-08-25T08:05:00.000Z')
// Stands in for the server secret the composition passes.
const ADDRESS_KEY = 'notification-email-suppression-test-key-0001'

const KEYS = { emailAddressKey: ADDRESS_KEY }

describe.sequential('durable email suppression (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const forgetAddress = () => forgetEmailAddress(db, KEYS, ADDRESS)
  const isSuppressed = (keys: EmailAddressKeys = KEYS, address = ADDRESS) =>
    isEmailAddressSuppressed(db, keys, address)

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
    await markNotificationEmailAccepted(
      db,
      EMAIL,
      ORG,
      PROPERTY,
      'resend-suppression-1',
      NOW,
    )
    await applyResendEvent(
      {
        db,
        emailAddressKeys: KEYS,
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
  }

  it('still refuses a hard-bounced address after retention deleted the rows that proved it', async () => {
    await deliverEvent('email.bounced', 'Permanent')

    // The 90-day sweep deletes terminal queue rows; the next notice is new.
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))

    await expect(isSuppressed()).resolves.toBe(true)
  })

  it('writes a complaint the first delivery lost once the provider retries it', async () => {
    await markNotificationEmailAccepted(
      db,
      EMAIL,
      ORG,
      PROPERTY,
      'resend-suppression-1',
      NOW,
    )
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
          db,
          emailAddressKeys: KEYS,
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
        db,
        emailAddressKeys: KEYS,
        userLookup: { getEmail: async () => ADDRESS },
        logger: createFakeJobLogger(),
      },
      event,
    )

    await expect(isSuppressed()).resolves.toBe(true)
  })

  it('keeps a spam complaint as durably as a hard bounce', async () => {
    await deliverEvent('email.complained')

    await expect(isSuppressed()).resolves.toBe(true)
  })

  it('leaves the address mailable after a transient bounce', async () => {
    await deliverEvent('email.bounced', 'Transient')

    await expect(isSuppressed()).resolves.toBe(false)
  })

  it('follows the address, not the user: a different address is not refused', async () => {
    await deliverEvent('email.bounced', 'Permanent')

    await expect(isSuppressed(KEYS, 'new-address@example.com')).resolves.toBe(false)
  })

  it('never counts a local suppression as the provider refusing the address', async () => {
    await markNotificationEmailSuppressed(
      db,
      EMAIL,
      ORG,
      PROPERTY,
      'preference_disabled',
      NOW,
    )

    await expect(isSuppressed()).resolves.toBe(false)
  })

  it('lifts the suppression when the provider takes the address off its list', async () => {
    await deliverEvent('email.bounced', 'Permanent')

    await applyResendEvent(
      {
        db,
        emailAddressKeys: KEYS,
        userLookup: { getEmail: async () => null },
        logger: createFakeJobLogger(),
      },
      {
        type: 'suppression.removed',
        // As the provider spells it, which need not be how we stored it.
        address: ` ${ADDRESS.toUpperCase()} `,
        occurredAt: LATER,
        eventId: 'msg_suppression_removed',
      },
    )

    await expect(isSuppressed()).resolves.toBe(false)
  })

  it('keys the address with the server secret, so a dictionary of digests finds nothing', async () => {
    await deliverEvent('email.bounced', 'Permanent')
    const bareDigest = createHash('sha256').update(ADDRESS, 'utf8').digest('hex')

    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM notification_email_suppressions
           WHERE address_hash = ${bareDigest}`,
    )

    expect(rows.rows[0]).toEqual({ n: 0 })
    await expect(isSuppressed()).resolves.toBe(true)
    await expect(
      isSuppressed({ emailAddressKey: 'a-different-server-secret-0000000000' }),
    ).resolves.toBe(false)
  })

  it('refuses to answer without its key rather than guess', async () => {
    await expect(isSuppressed({})).rejects.toThrow(
      'Email address suppression requires its key',
    )
  })

  it('stores a digest of the address, never the address itself', async () => {
    await deliverEvent('email.bounced', 'Permanent')

    const rows = await db.execute(sql`SELECT * FROM notification_email_suppressions`)

    expect(JSON.stringify(rows.rows)).not.toContain('@')
    expect(JSON.stringify(rows.rows)).not.toContain('suppression-test')
  })
})
