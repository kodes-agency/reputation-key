// The notice that a site is waiting for an account admin, against PostgreSQL
// (ADR 0046, amended 2026-10-26). It is Property-scoped and filed under the
// site, so the shape the database already admits holds it: no migration. One
// row per admin and site, repeats fold into it, and a decision settles every
// admin's row for that site and no other.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createNotification } from '../../domain/notification-constructors'
import { createNotificationRepository } from './notification.repository'

const ORG_A = organizationId('b7500000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7500000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('b7500000-0000-4000-8000-000000000011')
const ADMIN_1 = userId('site-notice-admin-1')
const ADMIN_2 = userId('site-notice-admin-2')
const MENU = 'b7500000-0000-4000-8000-0000000000a1'
const SPA_PAGE = 'b7500000-0000-4000-8000-0000000000a2'
const LOBBY = 'b7500000-0000-4000-8000-0000000000b1'
const NOW = new Date('2026-10-26T09:00:00.000Z')
const LATER = new Date('2026-10-26T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['notifications', 'properties'],
})

const repository = () =>
  createNotificationRepository(drizzle(getPool()) as unknown as Database)

const seedProperty = () =>
  getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, NOW],
  )

const noticeFor = (
  recipient: ReturnType<typeof userId>,
  site: string,
  host: string,
  eventId: string = randomUUID(),
) => {
  const built = createNotification(
    {
      id: notificationId(randomUUID()),
      userId: recipient,
      organizationId: ORG_A,
      propertyId: PROPERTY,
      type: 'portal.link_approval',
      resourceType: 'portal_destination',
      resourceId: site,
      eventId,
      payload: {
        propertyName: 'Harbour House',
        siteHost: host,
        portalName: 'Lobby',
        portalId: LOBBY,
      },
    },
    () => NOW,
  )
  if (built.isErr()) throw built.error
  return built.value
}

const resolved = async (): Promise<ReadonlyArray<string>> => {
  const { rows } = await getPool().query(
    `SELECT user_id || ':' || resource_id AS key FROM notifications
      WHERE organization_id = $1 AND resolved_at IS NOT NULL ORDER BY 1`,
    [ORG_A],
  )
  return rows.map((row: { key: string }) => row.key)
}

describe('a site waiting for approval against PostgreSQL', () => {
  it('stores for a Property, under the site, as collaboration, with what the copy needs', async () => {
    await seedProperty()

    const stored = await repository().insert(noticeFor(ADMIN_1, MENU, 'menu.example.com'))

    expect(stored).toMatchObject({
      propertyId: PROPERTY,
      type: 'portal.link_approval',
      category: 'workflow_collaboration',
      resourceType: 'portal_destination',
      resourceId: MENU,
      status: 'unread',
      payload: {
        siteHost: 'menu.example.com',
        portalName: 'Lobby',
        portalId: LOBBY,
      },
    })
  })

  it('is refused without a Property, which only the mandatory and listed notices may omit', async () => {
    const refused = await getPool()
      .query(
        `INSERT INTO notifications
           (id, user_id, organization_id, property_id, type, category, priority, status,
            resource_type, resource_id, event_id, title)
         VALUES ($1, $2, $3, NULL, 'portal.link_approval', 'workflow_collaboration',
                 'normal', 'unread', 'portal_destination', $4, $5, 'x')`,
        [randomUUID(), ADMIN_1, ORG_A, MENU, randomUUID()],
      )
      .then(
        () => null,
        (error: unknown) => (error as { constraint?: string }).constraint,
      )

    expect(refused).toBe('notifications_mandatory_scope_check')
  })

  it('gives every admin their own row, and folds a repeat for the same site into it', async () => {
    await seedProperty()
    const first = await repository().insert(noticeFor(ADMIN_1, MENU, 'menu.example.com'))
    await repository().insert(noticeFor(ADMIN_2, MENU, 'menu.example.com'))

    const repeat = await repository().insert(noticeFor(ADMIN_1, MENU, 'menu.example.com'))

    expect(repeat.id).toBe(first.id)
    const { rows } = await getPool().query(
      `SELECT user_id, coalesced_count FROM notifications
        WHERE organization_id = $1 ORDER BY user_id`,
      [ORG_A],
    )
    expect(rows).toEqual([
      { user_id: ADMIN_1, coalesced_count: 2 },
      { user_id: ADMIN_2, coalesced_count: 1 },
    ])
  })

  it('keeps one row per site: a second site is its own notice', async () => {
    await seedProperty()
    const menu = await repository().insert(noticeFor(ADMIN_1, MENU, 'menu.example.com'))
    const spa = await repository().insert(noticeFor(ADMIN_1, SPA_PAGE, 'spa.example.com'))

    expect(spa.id).not.toBe(menu.id)
  })

  it('settles every admin’s notice for the decided site, and no other', async () => {
    await seedProperty()
    await repository().insert(noticeFor(ADMIN_1, MENU, 'menu.example.com'))
    await repository().insert(noticeFor(ADMIN_2, MENU, 'menu.example.com'))
    await repository().insert(noticeFor(ADMIN_1, SPA_PAGE, 'spa.example.com'))

    const settled = await repository().settleUnreadForResource({
      organizationId: ORG_A,
      types: ['portal.link_approval'],
      resourceId: MENU,
      resolvedAt: LATER,
    })

    expect(settled).toHaveLength(2)
    expect(await resolved()).toEqual([`${ADMIN_1}:${MENU}`, `${ADMIN_2}:${MENU}`])
  })

  it('settles nothing for another Organization’s site id', async () => {
    await seedProperty()
    await repository().insert(noticeFor(ADMIN_1, MENU, 'menu.example.com'))

    const settled = await repository().settleUnreadForResource({
      organizationId: ORG_B,
      types: ['portal.link_approval'],
      resourceId: MENU,
      resolvedAt: LATER,
    })

    expect(settled).toEqual([])
    expect(await resolved()).toEqual([])
  })
})
