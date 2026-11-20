// Notification server functions, called as signed-in members over PostgreSQL
// with the real tenant resolution, execution policy, Feed public API and
// tracedHandler: a stale or foreign id answers a typed 404, a refused mute a
// typed 400, and a preference is written only for a Property of the caller's
// Organization.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  dismissNotificationFn,
  markNotificationReadFn,
  markNotificationUnreadFn,
  muteNotificationCategoryFn,
  restoreNotificationFn,
  undoNotificationCategoryMuteFn,
  updateNotificationPreferenceFn,
} from './notifications'

const harness = setupServerFunctionHarness({
  cleanupTables: ['notification_preferences', 'notifications'],
})

async function notify(
  reader: TestMember,
  property: TestProperty,
  options: { resourceId?: string } = {},
): Promise<string> {
  const id = randomUUID()
  await harness.pool().query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'review.created', 'workflow_collaboration', 'normal',
       'unread', 'inbox_item', $5, $6, 'Test', NOW(), NOW())`,
    [
      id,
      reader.userId,
      reader.organizationId,
      property.id,
      options.resourceId ?? `resource-${id}`,
      `event-${id}`,
    ],
  )
  return id
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await harness
    .pool()
    .query<{ status: string }>('SELECT status FROM notifications WHERE id = $1', [id])
  return rows[0]?.status
}

async function preferencesOf(member: TestMember, propertyId: string) {
  const { rows } = await harness.pool().query<{
    category: string
    channel: string
    enabled: boolean
    cadence: string
  }>(
    `SELECT category, channel, enabled, cadence FROM notification_preferences
      WHERE user_id = $1 AND organization_id = $2 AND property_id = $3
      ORDER BY category, channel`,
    [member.userId, member.organizationId, propertyId],
  )
  return rows
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

const STALE_ID = '90000000-0000-4000-8000-000000000001'

type OwnedRowMutation = (input: { data: { notificationId: string } }) => Promise<unknown>

const ownedRowMutations: ReadonlyArray<readonly [string, OwnedRowMutation]> = [
  ['markNotificationReadFn', markNotificationReadFn],
  ['markNotificationUnreadFn', markNotificationUnreadFn],
  ['dismissNotificationFn', dismissNotificationFn],
  ['restoreNotificationFn', restoreNotificationFn],
]

describe('notification mutations on one notification', () => {
  it('marks the reader’s own notification read and unread again', async () => {
    const { admin, property } = await hotel()
    const id = await notify(admin, property)

    await harness.callAs(admin, () =>
      markNotificationReadFn({ data: { notificationId: id } }),
    )
    expect(await statusOf(id)).toBe('read')

    await harness.callAs(admin, () =>
      markNotificationUnreadFn({ data: { notificationId: id } }),
    )
    expect(await statusOf(id)).toBe('unread')
  })

  it('answers null when another unread row already covers the same resource', async () => {
    const { admin, property } = await hotel()
    const resourceId = `resource-${randomUUID()}`
    const first = await notify(admin, property, { resourceId })
    await harness.callAs(admin, () =>
      markNotificationReadFn({ data: { notificationId: first } }),
    )
    await notify(admin, property, { resourceId })

    const flipped = await harness.callAs(admin, () =>
      markNotificationUnreadFn({ data: { notificationId: first } }),
    )

    expect(flipped).toBeNull()
    expect(await statusOf(first)).toBe('read')
  })

  it('dismisses a notification and restores it as it was', async () => {
    const { admin, property } = await hotel()
    const id = await notify(admin, property)

    await harness.callAs(admin, () =>
      dismissNotificationFn({ data: { notificationId: id } }),
    )
    expect(await statusOf(id)).toBe('dismissed')

    await harness.callAs(admin, () =>
      restoreNotificationFn({ data: { notificationId: id } }),
    )
    expect(await statusOf(id)).toBe('unread')
  })

  it.each(ownedRowMutations)(
    '%s answers a never-existing id with 404, not an untagged 500',
    async (_name, serverFn) => {
      const { admin } = await hotel()

      await expect(
        harness.callAs(admin, () => serverFn({ data: { notificationId: STALE_ID } })),
      ).rejects.toMatchObject({
        _tag: 'NotificationError',
        code: 'not_found',
        status: 404,
      })
    },
  )

  it.each(ownedRowMutations)(
    '%s answers a colleague’s notification with 404 and leaves it alone',
    async (_name, serverFn) => {
      const { organization, admin, property } = await hotel()
      const colleague = await harness.seedMember(organization, 'AccountAdmin')
      const theirs = await notify(colleague, property)

      await expect(
        harness.callAs(admin, () => serverFn({ data: { notificationId: theirs } })),
      ).rejects.toMatchObject({
        _tag: 'NotificationError',
        code: 'not_found',
        status: 404,
      })
      expect(await statusOf(theirs)).toBe('unread')
    },
  )

  it.each(ownedRowMutations)(
    '%s answers another Organization’s notification with 404 and leaves it alone',
    async (_name, serverFn) => {
      const { admin } = await hotel()
      const elsewhere = await harness.seedOrganization()
      const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')
      const strangersProperty = await harness.seedProperty(elsewhere)
      const theirs = await notify(stranger, strangersProperty)

      await expect(
        harness.callAs(admin, () => serverFn({ data: { notificationId: theirs } })),
      ).rejects.toMatchObject({
        _tag: 'NotificationError',
        code: 'not_found',
        status: 404,
      })
      expect(await statusOf(theirs)).toBe('unread')
    },
  )

  it('refuses a member whose role has no beta access and changes nothing', async () => {
    const { organization, admin, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')
    const id = await notify(admin, property)

    await expect(
      harness.callAs(member, () =>
        markNotificationReadFn({ data: { notificationId: id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await statusOf(id)).toBe('unread')
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () =>
        markNotificationReadFn({ data: { notificationId: STALE_ID } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('refuses an id that is not a UUID', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        markNotificationReadFn({ data: { notificationId: 'not-a-uuid' } }),
      ),
    ).rejects.toThrow(/notificationId/)
  })
})

describe('muteNotificationCategoryFn and undoNotificationCategoryMuteFn', () => {
  it('mutes an optional in-app category for the Property and undoes it', async () => {
    const { manager, property } = await hotel()

    const muted = await harness.callAs(manager, () =>
      muteNotificationCategoryFn({
        data: { propertyId: property.id, category: 'workflow_collaboration' },
      }),
    )
    expect(muted).toMatchObject({ previous: null })
    expect(await preferencesOf(manager, property.id)).toMatchObject([
      { category: 'workflow_collaboration', channel: 'in_app', enabled: false },
    ])

    await harness.callAs(manager, () =>
      undoNotificationCategoryMuteFn({
        data: {
          propertyId: property.id,
          category: 'workflow_collaboration',
          previous: null,
        },
      }),
    )
    expect(await preferencesOf(manager, property.id)).toEqual([])
  })

  it('refuses to mute a required in-app channel with 400 and the domain reason', async () => {
    const { manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        muteNotificationCategoryFn({
          data: { propertyId: property.id, category: 'urgent_operational' },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'NotificationError',
      code: 'invalid_input',
      status: 400,
      message: 'This notification channel is required and cannot be disabled',
    })
    expect(await preferencesOf(manager, property.id)).toEqual([])
  })

  it('refuses to undo a mute of a required in-app channel with 400 and writes nothing', async () => {
    const { manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        undoNotificationCategoryMuteFn({
          data: {
            propertyId: property.id,
            category: 'urgent_operational',
            previous: null,
          },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'NotificationError',
      code: 'invalid_input',
      status: 400,
    })
    expect(await preferencesOf(manager, property.id)).toEqual([])
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        muteNotificationCategoryFn({
          data: { propertyId: property.id, category: 'workflow_collaboration' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(await preferencesOf(outsider, property.id)).toEqual([])
  })
})

describe('updateNotificationPreferenceFn', () => {
  const choice = {
    category: 'workflow_collaboration',
    channel: 'in_app',
    enabled: true,
    cadence: 'daily',
  } as const

  it('writes the preference for a Property of the caller’s Organization', async () => {
    const { admin, property } = await hotel()

    await harness.callAs(admin, () =>
      updateNotificationPreferenceFn({ data: { propertyId: property.id, ...choice } }),
    )

    expect(await preferencesOf(admin, property.id)).toEqual([
      {
        category: 'workflow_collaboration',
        channel: 'in_app',
        enabled: true,
        cadence: 'daily',
      },
    ])
  })

  it('writes the preference for a PropertyManager the Property was granted to', async () => {
    const { manager, property } = await hotel()

    await harness.callAs(manager, () =>
      updateNotificationPreferenceFn({ data: { propertyId: property.id, ...choice } }),
    )

    expect(await preferencesOf(manager, property.id)).toHaveLength(1)
  })

  it('refuses a Property of another Organization with a typed not-found and writes nothing', async () => {
    const { admin } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const foreign = await harness.seedProperty(elsewhere)

    await expect(
      harness.callAs(admin, () =>
        updateNotificationPreferenceFn({ data: { propertyId: foreign.id, ...choice } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
    expect(await preferencesOf(admin, foreign.id)).toEqual([])
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        updateNotificationPreferenceFn({ data: { propertyId: property.id, ...choice } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(await preferencesOf(outsider, property.id)).toEqual([])
  })

  it('refuses a member whose role has no beta access', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        updateNotificationPreferenceFn({ data: { propertyId: property.id, ...choice } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await preferencesOf(member, property.id)).toEqual([])
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        updateNotificationPreferenceFn({ data: { propertyId: property.id, ...choice } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('refuses a category or channel the settings do not have', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        updateNotificationPreferenceFn({
          data: { propertyId: property.id, ...choice, category: 'gossip' } as never,
        }),
      ),
    ).rejects.toThrow(/category/)
    await expect(
      harness.callAs(admin, () =>
        updateNotificationPreferenceFn({
          data: { propertyId: property.id, ...choice, channel: 'pigeon' } as never,
        }),
      ),
    ).rejects.toThrow(/channel/)
    expect(await preferencesOf(admin, property.id)).toEqual([])
  })
})
