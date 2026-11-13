// A notice asked for again after its work was settled, against the real
// database and the real insert path.
//
// Settling leaves a row unread (read is not resolved), so a settled row used
// to keep ADR 0046 r.2's coalescing slot: the next escalation, resubmitted
// approval or later cycle's reminder folded into it and queued no email,
// because only a mandatory repeat is mailed. A settled row now leaves the
// slot, and the new ask gets a row and an email of its own.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  properties,
} from '#/shared/db/schema'
import {
  notificationEmailId,
  notificationId,
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createFakeJobLogger } from '../jobs/test-fixtures'
import { upsert as upsertPreference } from '../../preferences/notification-preferences.server'
import {
  insertNotification,
  type InsertNotificationInput,
} from '../../application/use-cases/insert-notification'
import type { NotificationType } from '../../domain/notification-types'
import {
  findNotificationById,
  settleUnreadForResource,
} from '../../notify/notification-rows.server'
import { writeNotification } from '../../notify/write.server'

const ORG = organizationId('notification-settled-repeat-org')
const PROPERTY = propertyId('87000000-0000-4000-8000-000000000001')
const ITEM = '87000000-0000-4000-8000-000000000002'
const MANAGER = userId('notification-settled-repeat-manager')
const SETTLED_AT = new Date('2026-09-23T23:30:00.000Z')

const escalation = (
  eventId: string,
  type: NotificationType = 'inbox.escalated',
): InsertNotificationInput => ({
  userId: MANAGER,
  organizationId: ORG,
  propertyId: PROPERTY,
  type,
  resourceType: 'inbox_item',
  resourceId: ITEM,
  eventId,
  payload: { propertyName: 'Repeat Hotel' },
})

describe.sequential('a notice asked for again after settlement (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clearRows = async () => {
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.organizationId, ORG))
  }

  // The reader's own rows for the Property: email always on and immediate,
  // in-app as given. A row per channel is how the preference is really read.
  const preferIn = async (inApp: boolean) => {
    for (const channel of ['in_app', 'email'] as const) {
      await upsertPreference(db, {
        id: notificationPreferenceId(randomUUID()),
        userId: MANAGER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'workflow_collaboration',
        channel,
        enabled: channel === 'email' || inApp,
        cadence: 'immediate',
        createdAt: SETTLED_AT,
        updatedAt: SETTLED_AT,
      })
    }
  }

  const insertWith = async (inApp: boolean) => {
    await preferIn(inApp)
    return insertNotification({
      db,
      clock: () => SETTLED_AT,
      idGen: () => notificationId(randomUUID()),
      emailIdGen: () => notificationEmailId(randomUUID()),
      logger: createFakeJobLogger(),
      ratingForRouting: async () => null,
    })
  }

  const settle = (type: NotificationType = 'inbox.escalated') =>
    settleUnreadForResource(db, {
      organizationId: ORG,
      types: [type],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

  const managerRows = () =>
    db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, ORG), eq(notifications.userId, MANAGER)),
      )

  const managerEmails = () =>
    db
      .select()
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearRows()
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Repeat Hotel',
      slug: 'notification-settled-repeat',
      timezone: 'UTC',
    })
  })

  beforeEach(clearRows)

  afterAll(async () => {
    if (db) {
      await clearRows()
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }
    await lease?.release()
  })

  it('emails a second escalation raised after the first was resolved', async () => {
    const insert = await insertWith(true)
    const first = await insert(escalation('settled-repeat-escalated-1'))
    await settle()

    const second = await insert(escalation('settled-repeat-escalated-2'))

    expect(second?.id).not.toBe(first?.id)
    const rows = await managerRows()
    expect(rows.find((row) => row.id === first?.id)?.resolvedAt).not.toBeNull()
    expect(rows.find((row) => row.id === second?.id)).toMatchObject({
      status: 'unread',
      resolvedAt: null,
    })
    const emails = await managerEmails()
    expect(emails.map((email) => email.notificationId).sort()).toEqual(
      [first?.id, second?.id].sort(),
    )
  })

  it('still folds a repeat into a row whose work is waiting', async () => {
    const insert = await insertWith(true)
    const first = await insert(escalation('settled-repeat-waiting-1'))

    const second = await insert(escalation('settled-repeat-waiting-2'))

    expect(second?.id).toBe(first?.id)
    expect(second?.coalescedCount).toBe(2)
    expect(await managerEmails()).toHaveLength(1)
  })

  it('gives a racing repeat its own row instead of reviving the settled one', async () => {
    const insert = await insertWith(true)
    const first = await insert(escalation('settled-repeat-race-1'))
    await settle()

    const raced = await writeNotification(db, {
      ...first!,
      id: notificationId(randomUUID()),
      eventId: 'settled-repeat-race-2',
    })

    expect(raced.id).not.toBe(first?.id)
    expect(raced.resolvedAt).toBeNull()
    expect((await findNotificationById(db, first!.id, ORG))?.resolvedAt).not.toBeNull()
  })

  it('settles an email-only anchor, so its queued email is not sent for done work', async () => {
    // A Response Target reminder: Collaboration's in-app channel may be off.
    const halfway = 'inbox.response_target_halfway'
    await (
      await insertWith(false)
    )(escalation('settled-repeat-email-only', halfway))

    const settled = await settle(halfway)

    expect(settled).toHaveLength(1)
    const [anchor] = await managerRows()
    expect(anchor).toMatchObject({ status: 'read', readAt: null })
    expect(anchor?.resolvedAt).not.toBeNull()
  })
})
