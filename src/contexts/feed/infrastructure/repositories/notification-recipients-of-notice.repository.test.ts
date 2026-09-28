// The evidence of who was told something, against the real database.
//
// "Escalation resolved" reaches the AccountAdmins who were told the item was
// escalated. An item can be escalated, resolved and escalated again, and the
// rows of the first escalation stay in the table, so the evidence has to be
// bounded to the notices that arrived since the current one was raised.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notifications, properties } from '#/shared/db/schema'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotification } from '../../domain/notification-constructors'
import { createNotificationRepository } from './notification.repository'

const ORG = organizationId('notification-recipients-of-notice-org')
const PROPERTY = propertyId('87000000-0000-4000-8000-000000000001')
const ITEM = '87000000-0000-4000-8000-000000000002'
const EARLIER_ADMIN = userId('recipients-of-notice-earlier-admin')
const REPEATED_ADMIN = userId('recipients-of-notice-repeated-admin')
const CURRENT_MANAGER = userId('recipients-of-notice-current-manager')
const FIRST_ESCALATION = new Date('2026-09-20T06:00:00.000Z')
const CURRENT_ESCALATION = new Date('2026-09-20T07:00:00.000Z')
const CURRENT_ARRIVAL = new Date('2026-09-20T07:00:05.000Z')

const escalatedNotice = (id: string, recipient: ReturnType<typeof userId>, at: Date) => {
  const built = createNotification(
    {
      id: notificationId(id),
      userId: recipient,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'inbox.escalated',
      resourceType: 'inbox_item',
      resourceId: ITEM,
      eventId: `recipients-of-notice-${id}`,
      payload: { propertyName: 'Evidence Hotel' },
    },
    () => at,
  )
  if (built.isErr()) throw built.error
  return built.value
}

describe.sequential('who was told a notice (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clearScope = async () => {
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearScope()
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Evidence Hotel',
      slug: 'notification-recipients-of-notice',
      timezone: 'UTC',
    })
  })

  beforeEach(async () => {
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    const repo = createNotificationRepository(db)
    // Told about the first escalation only.
    await repo.insert(
      escalatedNotice(
        '87000000-0000-4000-8000-000000000011',
        EARLIER_ADMIN,
        FIRST_ESCALATION,
      ),
    )
    // Told about both: the second arrival coalesced into the unread first row.
    await repo.insert(
      escalatedNotice(
        '87000000-0000-4000-8000-000000000012',
        REPEATED_ADMIN,
        FIRST_ESCALATION,
      ),
    )
    await repo.insert(
      escalatedNotice(
        '87000000-0000-4000-8000-000000000013',
        REPEATED_ADMIN,
        CURRENT_ARRIVAL,
      ),
    )
    // Told about the current escalation only.
    await repo.insert(
      escalatedNotice(
        '87000000-0000-4000-8000-000000000014',
        CURRENT_MANAGER,
        CURRENT_ARRIVAL,
      ),
    )
  })

  afterAll(async () => {
    if (db) await clearScope()
    await lease?.release()
  })

  it('counts only the notices that arrived since the current escalation', async () => {
    const told = await createNotificationRepository(db).findRecipientsOfNotice(
      ORG,
      'inbox.escalated',
      ITEM,
      CURRENT_ESCALATION,
    )

    expect([...told].sort()).toEqual([CURRENT_MANAGER, REPEATED_ADMIN].sort())
  })

  it('reads every notice ever held when nothing bounds it', async () => {
    const told = await createNotificationRepository(db).findRecipientsOfNotice(
      ORG,
      'inbox.escalated',
      ITEM,
      null,
    )

    expect([...told].sort()).toEqual(
      [CURRENT_MANAGER, EARLIER_ADMIN, REPEATED_ADMIN].sort(),
    )
  })
})
