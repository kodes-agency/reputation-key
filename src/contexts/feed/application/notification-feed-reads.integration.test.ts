// The reader's feed and its bulk actions follow current Property access, on
// PostgreSQL: the rows each read returns and each bulk action changes.
// One held transaction per test, always rolled back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { notifications } from '#/shared/db/schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import {
  notificationId,
  organizationId,
  propertyId,
  userId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { createNotification } from '../domain/notification-constructors'
import type { NotificationType } from '../domain/notification-types'
import { writeNotification } from '../notify/write.server'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { createNotificationFeedReads } from './notification-feed-reads'

const HARBOR = propertyId('84000000-0000-4000-8000-000000000002')
const ANNEX = propertyId('84000000-0000-4000-8000-000000000003')
const READER = {
  userId: userId('user-notification-reads'),
  organizationId: organizationId('org-notification-reads'),
} as const
const OTHER_HARBOR = propertyId('84000000-0000-4000-8000-000000000004')
const OTHER_ORGANIZATION = organizationId('org-notification-reads-other')
const NOW = new Date('2026-09-22T09:00:00.000Z')
const SEEDED_AT = new Date('2026-09-22T08:00:00.000Z')

let held: HeldTransaction
let nextNotice = 1

type Seed = Readonly<{
  organizationId?: OrganizationId
  propertyId: PropertyId | null
  type: NotificationType
}>

/** A notice for the reader; its resource id is returned so a test can name it. */
async function seed(spec: Seed): Promise<string> {
  const n = nextNotice++
  const resourceId =
    spec.propertyId === null
      ? 'org-notification-reads-integration'
      : `84000000-0000-4000-9000-${String(n).padStart(12, '0')}`
  const built = createNotification(
    {
      id: notificationId(`84000000-0000-4000-a000-${String(n).padStart(12, '0')}`),
      userId: READER.userId,
      organizationId: spec.organizationId ?? READER.organizationId,
      propertyId: spec.propertyId,
      type: spec.type,
      resourceType: spec.propertyId === null ? 'integration' : 'inbox_item',
      resourceId,
      eventId: `event-${n}`,
      payload: { propertyName: 'Harbor' },
    },
    () => SEEDED_AT,
  )
  if (built.isErr()) throw built.error
  await writeNotification(held.db, built.value)
  return resourceId
}

const resourceIds = (page: { notifications: ReadonlyArray<{ resourceId: string }> }) =>
  page.notifications.map((notice) => notice.resourceId).sort()

async function statusOf(resourceId: string): Promise<string> {
  const rows = await held.db
    .select({ status: notifications.status })
    .from(notifications)
    .where(eq(notifications.resourceId, resourceId))
    .orderBy(asc(notifications.createdAt))
  return rows[0]!.status
}

// One held transaction is one connection: read the rows one at a time.
async function statusesOf(resourceIds: readonly string[]): Promise<string[]> {
  const statuses: string[] = []
  for (const resourceId of resourceIds) statuses.push(await statusOf(resourceId))
  return statuses
}

function readsFor(accessible: ReadonlyArray<PropertyId> | null) {
  const propertyAccess = vi.fn(async () => accessible)
  const reads = createNotificationFeedReads({
    db: held.db,
    propertyAccess,
    clock: () => NOW,
  })
  return { reads, propertyAccess }
}

const admin = (organizationId: OrganizationId = READER.organizationId): AuthContext => ({
  ...READER,
  organizationId,
  role: 'AccountAdmin',
})
const manager: AuthContext = { ...READER, role: 'PropertyManager' }

describe.sequential('notification feed reads follow current Property access', () => {
  beforeEach(async () => {
    held = await holdTransaction()
    await seedProperty(held.db, { id: HARBOR, organizationId: READER.organizationId })
    await seedProperty(held.db, { id: ANNEX, organizationId: READER.organizationId })
    await seedProperty(held.db, { id: OTHER_HARBOR, organizationId: OTHER_ORGANIZATION })
  })
  afterEach(async () => {
    await held.rollBack()
  })

  it('keeps the same AccountAdmin separate in two Organizations for reads and bulk actions', async () => {
    const mine = [
      await seed({ propertyId: HARBOR, type: 'inbox.escalated' }),
      await seed({ propertyId: null, type: 'integration.google_disconnected' }),
    ]
    const theirs = [
      await seed({
        organizationId: OTHER_ORGANIZATION,
        propertyId: OTHER_HARBOR,
        type: 'inbox.escalated',
      }),
    ]
    const { reads } = readsFor(null)

    const head = await reads.getFeedHead(admin(), { limit: 20, filter: 'all' })
    const page = await reads.getNotifications(admin(), {
      limit: 20,
      filter: 'all',
      before: null,
    })
    const otherHead = await reads.getFeedHead(admin(OTHER_ORGANIZATION), {
      limit: 20,
      filter: 'all',
    })
    expect(resourceIds(head.page)).toEqual([...mine].sort())
    expect(head.unreadCount).toBe(2)
    expect(resourceIds(page)).toEqual([...mine].sort())
    expect(resourceIds(otherHead.page)).toEqual(theirs)

    await reads.markAllRead(admin(), 'all')
    expect(await statusesOf([...mine, ...theirs])).toEqual(['read', 'read', 'unread'])

    await reads.dismissAll(admin())
    expect(await statusesOf([...mine, ...theirs])).toEqual([
      'dismissed',
      'dismissed',
      'unread',
    ])
  })

  it('scopes an assigned-Property manager to the Properties they can still access', async () => {
    const harbor = await seed({ propertyId: HARBOR, type: 'inbox.escalated' })
    const organizationNotice = await seed({
      propertyId: null,
      type: 'integration.google_disconnected',
    })
    await seed({ propertyId: ANNEX, type: 'inbox.escalated' })
    const { reads, propertyAccess } = readsFor([HARBOR])

    const head = await reads.getFeedHead(manager, { limit: 20, filter: 'all' })
    const page = await reads.getNotifications(manager, {
      limit: 20,
      filter: 'unread',
      before: null,
    })

    expect(propertyAccess).toHaveBeenCalledWith(
      READER.organizationId,
      READER.userId,
      false,
    )
    expect(resourceIds(head.page)).toEqual([harbor, organizationNotice].sort())
    expect(head.unreadCount).toBe(2)
    expect(resourceIds(page)).toEqual([harbor, organizationNotice].sort())
  })

  it('leaves an Organization-wide reader unscoped without a lookup', async () => {
    const harbor = await seed({ propertyId: HARBOR, type: 'inbox.escalated' })
    const annex = await seed({ propertyId: ANNEX, type: 'inbox.escalated' })
    const { reads, propertyAccess } = readsFor([HARBOR])

    const head = await reads.getFeedHead(admin(), { limit: 20, filter: 'all' })

    expect(propertyAccess).not.toHaveBeenCalled()
    expect(resourceIds(head.page)).toEqual([harbor, annex].sort())
  })

  it('keeps only Organization notices when notification.read has no data scope', async () => {
    await seed({ propertyId: HARBOR, type: 'inbox.escalated' })
    const organizationNotice = await seed({
      propertyId: null,
      type: 'integration.google_disconnected',
    })
    const { reads } = readsFor([HARBOR])
    const unscoped: AuthContext = {
      ...manager,
      scopeByPermission: new Map([['inbox.read', 'assigned-properties']]),
    }

    const head = await reads.getFeedHead(unscoped, { limit: 20, filter: 'all' })

    expect(resourceIds(head.page)).toEqual([organizationNotice])
  })

  it("narrows the reads and both bulk actions to the page's Property filter", async () => {
    const harborWaiting = await seed({ propertyId: HARBOR, type: 'inbox.escalated' })
    const harborUpdate = await seed({ propertyId: HARBOR, type: 'inbox_note.added' })
    const annex = await seed({ propertyId: ANNEX, type: 'inbox.escalated' })
    const organizationNotice = await seed({
      propertyId: null,
      type: 'integration.google_disconnected',
    })
    const { reads } = readsFor([HARBOR, ANNEX])

    const head = await reads.getFeedHead(manager, {
      limit: 50,
      filter: 'all',
      propertyId: HARBOR,
    })
    const page = await reads.getNotifications(manager, {
      limit: 50,
      filter: 'needs_you',
      propertyId: HARBOR,
      before: null,
    })
    expect(resourceIds(head.page)).toEqual([harborWaiting, harborUpdate].sort())
    expect(resourceIds(page)).toEqual([harborWaiting])

    await reads.markAllRead(manager, 'needs_you', HARBOR)
    expect(
      await statusesOf([harborWaiting, harborUpdate, annex, organizationNotice]),
    ).toEqual(['read', 'unread', 'unread', 'unread'])

    await reads.dismissAll(manager, HARBOR)
    expect(
      await statusesOf([harborWaiting, harborUpdate, annex, organizationNotice]),
    ).toEqual(['dismissed', 'dismissed', 'unread', 'unread'])
  })

  it('scopes "Mark all read" and "Clear all" to the rows the reads show', async () => {
    const harborUrgent = await seed({ propertyId: HARBOR, type: 'inbox.escalated' })
    const harborCalm = await seed({ propertyId: HARBOR, type: 'inbox_note.added' })
    const annexUrgent = await seed({ propertyId: ANNEX, type: 'inbox.escalated' })
    const all = [harborUrgent, harborCalm, annexUrgent]
    const { reads } = readsFor([HARBOR])

    await reads.markAllRead(manager, 'urgent')
    expect(await statusesOf(all)).toEqual(['read', 'unread', 'unread'])

    await reads.dismissAll(manager)
    expect(await statusesOf(all)).toEqual(['dismissed', 'dismissed', 'unread'])
  })
})
