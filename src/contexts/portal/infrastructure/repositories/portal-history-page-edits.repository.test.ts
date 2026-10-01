// The page-edit source of the History read, against real PostgreSQL: this
// Portal's edits plus the Property's look and welcome text since the Portal
// existed, newest first, fenced to one Organization and Property, and paged
// without skipping or repeating a row that shares an instant.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { HISTORY_KEY_PREFIX, historyBoundFor } from '../../domain/portal-history'
import { createPortalHistoryRepository } from './portal-history.repository'

const ORG = organizationId('org-page-edit-hist-0000000000001')
const OTHER_ORG = organizationId('org-page-edit-hist-0000000000002')
const PROPERTY = propertyId('e5a00000-0000-4000-8000-000000000001')
const SIBLING_PROPERTY = propertyId('e5a00000-0000-4000-8000-000000000002')
const OTHER_ORG_PROPERTY = propertyId('e5a00000-0000-4000-8000-000000000003')
const PORTAL = portalId('e5b00000-0000-4000-8000-000000000001')
const SIBLING_PORTAL = portalId('e5b00000-0000-4000-8000-000000000002')
const OTHER_ORG_PORTAL = portalId('e5b00000-0000-4000-8000-000000000003')
const T0 = new Date('2026-09-01T10:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['portal_page_edits', 'portals', 'properties'],
})

const editId = (n: number) =>
  `e5c00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

async function seedPortals() {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $4, 'Edit History', 'edit-history', 'UTC', $6, $6),
            ($2, $4, 'Sibling Property', 'sibling-property', 'UTC', $6, $6),
            ($3, $5, 'Other Org Property', 'other-org-property', 'UTC', $6, $6)`,
    [PROPERTY, SIBLING_PROPERTY, OTHER_ORG_PROPERTY, ORG, OTHER_ORG, T0],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $4, $5, 'property', $8, 'Edited Portal', 'edited-portal', $9, $9),
            ($2, $4, $6, 'property', $10, 'Sibling Portal', 'sibling-portal', $9, $9),
            ($3, $7, $11, 'property', $12, 'Other Org Portal', 'other-org-portal', $9, $9)`,
    [
      PORTAL,
      SIBLING_PORTAL,
      OTHER_ORG_PORTAL,
      ORG,
      PROPERTY,
      SIBLING_PROPERTY,
      OTHER_ORG,
      PROPERTY,
      T0,
      SIBLING_PROPERTY,
      OTHER_ORG_PROPERTY,
      OTHER_ORG_PROPERTY,
    ],
  )
}

type Seed = Readonly<{
  n: number
  org?: string
  property?: string
  portal?: string | null
  kind?: string
  key?: string
  actor?: string | null
  previousText?: string | null
  newText?: string | null
  count?: number
  when: Date
}>

async function seedEdit(input: Seed) {
  await getPool().query(
    `INSERT INTO portal_page_edits
       (id, organization_id, property_id, portal_id, change_kind, change_key, actor_user_id,
        occurred_at, previous_text, new_text, edit_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      editId(input.n),
      input.org ?? ORG,
      input.property ?? PROPERTY,
      input.portal === undefined ? PORTAL : input.portal,
      input.kind ?? 'portal_links',
      input.key ?? 'all',
      input.actor === undefined ? 'elena' : input.actor,
      input.when,
      input.previousText ?? null,
      input.newText ?? null,
      input.count ?? 1,
    ],
  )
}

beforeEach(seedPortals)

const list = (
  limit = 10,
  bound = null as ReturnType<typeof historyBoundFor>,
  since = T0,
) =>
  createPortalHistoryRepository(getDb()).listPageEdits(
    ORG,
    PROPERTY,
    PORTAL,
    { bound, limit },
    since,
  )

describe.sequential('Portal history page edits (real PostgreSQL)', () => {
  it('lists this Portal and the Property-wide edits newest first, with kind, key and actor', async () => {
    await seedEdit({
      n: 1,
      when: at(10),
      key: 'link:e5d00000-0000-4000-8000-000000000001:updated',
      previousText: 'Dinner menu',
      newText: 'Olive Terrace menu',
      count: 4,
    })
    await seedEdit({
      n: 2,
      when: at(20),
      portal: null,
      kind: 'property_brand_profile',
      key: 'look:accent',
      actor: null,
    })
    await seedEdit({ n: 3, when: at(5), kind: 'portal_localized_override', key: 'es' })

    expect(await list()).toEqual([
      {
        editId: editId(2),
        kind: 'property_brand_profile',
        key: 'look:accent',
        actorUserId: null,
        occurredAt: at(20),
        propertyWide: true,
        previousText: null,
        newText: null,
        editCount: 1,
      },
      {
        editId: editId(1),
        kind: 'portal_links',
        key: 'link:e5d00000-0000-4000-8000-000000000001:updated',
        actorUserId: 'elena',
        occurredAt: at(10),
        propertyWide: false,
        previousText: 'Dinner menu',
        newText: 'Olive Terrace menu',
        editCount: 4,
      },
      {
        editId: editId(3),
        kind: 'portal_localized_override',
        key: 'es',
        actorUserId: 'elena',
        occurredAt: at(5),
        propertyWide: false,
        previousText: null,
        newText: null,
        editCount: 1,
      },
    ])
  })

  it('shows nothing from a sibling Portal, another Property or another Organization', async () => {
    await seedEdit({
      n: 1,
      when: at(10),
      portal: SIBLING_PORTAL,
      property: SIBLING_PROPERTY,
    })
    await seedEdit({
      n: 2,
      when: at(11),
      portal: null,
      property: SIBLING_PROPERTY,
      kind: 'property_brand_content',
      key: 'en',
    })
    await seedEdit({
      n: 3,
      when: at(12),
      org: OTHER_ORG,
      property: OTHER_ORG_PROPERTY,
      portal: OTHER_ORG_PORTAL,
    })
    await seedEdit({ n: 4, when: at(13) })

    expect((await list()).map((row) => row.editId)).toEqual([editId(4)])
  })

  it('cannot hold a Property-wide edit that names this Property under another Organization', async () => {
    // The Property tenant foreign key refuses it, so the Organization predicate
    // is a second fence, never the only one.
    await expect(
      seedEdit({
        n: 1,
        when: at(10),
        org: OTHER_ORG,
        property: PROPERTY,
        portal: null,
        kind: 'property_brand_content',
        key: 'en',
      }),
    ).rejects.toThrow(/portal_page_edits_property_tenant_fk/)
    expect(await list()).toEqual([])
  })

  it('leaves out a Property-wide edit made before the Portal existed', async () => {
    await seedEdit({
      n: 1,
      when: at(-30),
      portal: null,
      kind: 'property_brand_content',
      key: 'en',
    })
    await seedEdit({
      n: 2,
      when: at(30),
      portal: null,
      kind: 'property_brand_content',
      key: 'en',
    })

    expect((await list()).map((row) => row.editId)).toEqual([editId(2)])
  })

  it('pages edits that share an instant without skipping or repeating one', async () => {
    for (const n of [1, 2, 3, 4]) await seedEdit({ n, when: at(10) })
    await seedEdit({ n: 5, when: at(20) })
    await seedEdit({
      n: 6,
      when: at(10),
      portal: null,
      kind: 'property_brand_profile',
      key: 'look:text',
    })

    const seen: string[] = []
    let position: { at: Date; key: string } | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = await list(2, historyBoundFor(HISTORY_KEY_PREFIX.edit, position))
      if (rows.length === 0) break
      seen.push(...rows.map((row) => row.editId))
      const last = rows[rows.length - 1]!
      position = { at: last.occurredAt, key: `${HISTORY_KEY_PREFIX.edit}${last.editId}` }
    }

    expect(seen).toEqual([5, 6, 4, 3, 2, 1].map(editId))
  })
})
