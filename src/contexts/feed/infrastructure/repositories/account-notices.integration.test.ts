// The two account notices Identity's access facts raise, against PostgreSQL:
// a member told their Property access changed, an inviter told an invitation
// was accepted. Both are mandatory and belong to the Organization, so they
// insert with no Property, pointing at the Organization, and the database
// refuses any other shape for them.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { notificationId, organizationId, userId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createNotification } from '../../domain/notification-constructors'
import type { NotificationPayload } from '../../domain/notification-payload'
import { renderNotification } from '../../domain/notification-templates'
import { createNotificationRepository } from './notification.repository'

const ORG_A = organizationId('b7400000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7400000-0000-4000-8000-000000000002')
const RECIPIENT = userId('account-notice-recipient')
const NOW = new Date('2026-10-01T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['notifications'],
})

const repository = () =>
  createNotificationRepository(drizzle(getPool()) as unknown as Database)

const TYPES = [
  'account.organization_property_access_changed',
  'account.invitation_accepted',
] as const

const build = (
  type: (typeof TYPES)[number],
  payload: NotificationPayload,
  eventId: string = randomUUID(),
) => {
  const built = createNotification(
    {
      id: notificationId(randomUUID()),
      userId: RECIPIENT,
      organizationId: ORG_A,
      propertyId: null,
      type,
      resourceType: 'organization',
      resourceId: ORG_A as string,
      eventId,
      payload,
    },
    () => NOW,
  )
  if (built.isErr()) throw built.error
  return built.value
}

const refusal = (
  type: (typeof TYPES)[number],
  propertyId: string | null,
  resource: string,
) =>
  getPool()
    .query(
      `INSERT INTO notifications
         (id, user_id, organization_id, property_id, type, category, priority, status,
          resource_type, resource_id, event_id, title)
       VALUES ($1, $2, $3, $4, $5, 'mandatory', 'normal', 'unread', $6, $3, $7, 'x')`,
      [randomUUID(), RECIPIENT, ORG_A, propertyId, type, resource, randomUUID()],
    )
    .then(
      () => null,
      (error: unknown) => (error as { constraint?: string }).constraint,
    )

describe.each(TYPES)('%s against PostgreSQL', (type) => {
  it('inserts with no Property, as a mandatory notice pointing at the Organization', async () => {
    const stored = await repository().insert(
      build(type, { organizationName: 'Riverside Group' }),
    )

    expect(stored).toMatchObject({
      propertyId: null,
      resourceType: 'organization',
      resourceId: ORG_A,
      category: 'mandatory',
      status: 'unread',
      payload: { organizationName: 'Riverside Group' },
    })
    const { rows } = await getPool().query(
      `SELECT property_id, resource_type, category FROM notifications WHERE id = $1`,
      [stored.id],
    )
    expect(rows).toEqual([
      { property_id: null, resource_type: 'organization', category: 'mandatory' },
    ])
  })

  it('folds a repeat into the one unread row, the newest facts winning', async () => {
    const first = await repository().insert(
      build(type, { organizationName: 'Riverside Group' }),
    )

    const repeat = await repository().insert(
      build(type, { organizationName: 'Riverside Hospitality' }),
    )

    expect(repeat).toMatchObject({
      id: first.id,
      coalescedCount: 2,
      payload: { organizationName: 'Riverside Hospitality', occurrences: 2 },
    })
    expect(renderNotification(repeat.type, repeat.payload).body).toContain(
      'Riverside Hospitality',
    )
  })

  it('refuses a Property, and any resource but the Organization', async () => {
    await expect(refusal(type, randomUUID(), 'organization')).resolves.toBe(
      'notifications_mandatory_scope_check',
    )
    await expect(refusal(type, null, 'inbox_item')).resolves.toBe(
      'notifications_mandatory_scope_check',
    )
    await expect(refusal(type, null, 'organization')).resolves.toBeNull()
  })
})
