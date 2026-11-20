// "Mark all read" carries the filter tab the reader is on to Feed, called as
// signed-in members over PostgreSQL with the real tenant resolution, execution
// policy and Property visibility.
//
// It used to take no input at all, so the Workflow tab's "Mark all read"
// cleared urgent Action-needed and account notices too.

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

import { markAllNotificationsReadFn } from './notifications'

const harness = setupServerFunctionHarness({ cleanupTables: ['notifications'] })

async function notify(
  reader: TestMember,
  property: TestProperty,
  category: 'workflow_collaboration' | 'urgent_operational',
): Promise<string> {
  const id = randomUUID()
  await harness.pool().query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'review.created', $5, $6, 'unread',
       'inbox_item', $7, $8, 'Test', NOW(), NOW())`,
    [
      id,
      reader.userId,
      reader.organizationId,
      property.id,
      category,
      category === 'urgent_operational' ? 'urgent' : 'normal',
      `resource-${id}`,
      `event-${id}`,
    ],
  )
  return id
}

async function statusOf(ids: readonly string[]): Promise<Record<string, string>> {
  const { rows } = await harness
    .pool()
    .query<{ id: string; status: string }>(
      'SELECT id, status FROM notifications WHERE id = ANY($1::uuid[])',
      [ids],
    )
  return Object.fromEntries(rows.map((row) => [row.id, row.status]))
}

async function inbox() {
  const organization = await harness.seedOrganization()
  const reader = await harness.seedMember(organization, 'AccountAdmin')
  const riverside = await harness.seedProperty(organization)
  const harbour = await harness.seedProperty(organization)
  const note = await notify(reader, riverside, 'workflow_collaboration')
  const alert = await notify(reader, riverside, 'urgent_operational')
  const harbourNote = await notify(reader, harbour, 'workflow_collaboration')
  return { organization, reader, riverside, harbour, note, alert, harbourNote }
}

describe('markAllNotificationsReadFn', () => {
  it('marks read only what the reader’s filter tab holds', async () => {
    const { reader, note, alert, harbourNote } = await inbox()

    await harness.callAs(reader, () =>
      markAllNotificationsReadFn({ data: { filter: 'workflow_collaboration' } }),
    )

    expect(await statusOf([note, alert, harbourNote])).toEqual({
      [note]: 'read',
      [alert]: 'unread',
      [harbourNote]: 'read',
    })
  })

  it("marks read only the page's filtered Property when one is chosen", async () => {
    const { reader, harbour, note, alert, harbourNote } = await inbox()

    await harness.callAs(reader, () =>
      markAllNotificationsReadFn({
        data: { filter: 'workflow_collaboration', propertyId: harbour.id },
      }),
    )

    expect(await statusOf([note, alert, harbourNote])).toEqual({
      [note]: 'unread',
      [alert]: 'unread',
      [harbourNote]: 'read',
    })
  })

  it('keeps marking everything for a tab still running the bundle that sent no filter', async () => {
    const { reader, note, alert, harbourNote } = await inbox()

    await harness.callAs(reader, () => markAllNotificationsReadFn({ data: undefined }))

    expect(await statusOf([note, alert, harbourNote])).toEqual({
      [note]: 'read',
      [alert]: 'read',
      [harbourNote]: 'read',
    })
  })

  it('leaves the notices of a Property the PropertyManager was not granted unread', async () => {
    const { organization, riverside, harbour } = await inbox()
    const manager = await harness.seedMember(organization, 'PropertyManager')
    await harness.grantProperty(manager, riverside)
    const granted = await notify(manager, riverside, 'workflow_collaboration')
    const notGranted = await notify(manager, harbour, 'workflow_collaboration')

    await harness.callAs(manager, () =>
      markAllNotificationsReadFn({ data: { filter: 'all' } }),
    )

    expect(await statusOf([granted, notGranted])).toEqual({
      [granted]: 'read',
      [notGranted]: 'unread',
    })
  })

  it("leaves other readers' notices alone", async () => {
    const { organization, reader, riverside, note } = await inbox()
    const colleague = await harness.seedMember(organization, 'AccountAdmin')
    const colleagues = await notify(colleague, riverside, 'workflow_collaboration')
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')
    const strangersProperty = await harness.seedProperty(elsewhere)
    const strangers = await notify(stranger, strangersProperty, 'workflow_collaboration')

    await harness.callAs(reader, () =>
      markAllNotificationsReadFn({ data: { filter: 'all' } }),
    )

    expect(await statusOf([note, colleagues, strangers])).toEqual({
      [note]: 'read',
      [colleagues]: 'unread',
      [strangers]: 'unread',
    })
  })

  it('refuses a filter the feed does not have and marks nothing', async () => {
    const { reader, note } = await inbox()

    await expect(
      harness.callAs(reader, () =>
        markAllNotificationsReadFn({ data: { filter: 'everything' } as never }),
      ),
    ).rejects.toThrow(/filter/)

    expect(await statusOf([note])).toEqual({ [note]: 'unread' })
  })

  it('refuses a caller with no session', async () => {
    const { note } = await inbox()

    await expect(
      harness.callAs(null, () => markAllNotificationsReadFn({ data: { filter: 'all' } })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(await statusOf([note])).toEqual({ [note]: 'unread' })
  })
})
