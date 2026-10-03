// The page-edit ledger writer: one row per Portal for a Portal-scoped kind,
// one Property row for the look and welcome text, and a pending-change fence
// beside it for every change that goes through `recordPortalContentChange`.
// A row may keep the wording before and after a change; saves of the same part
// by the same person fold into one row until a publication separates them.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { PORTAL_PAGE_EDIT_FOLD_WINDOW_MS } from '../domain/portal-page-edit'
import { recordPortalContentChange, recordPortalPageEdit } from './portal-page-edits'

const ORG_A = organizationId('org-page-edits-0000-0000-000000000001')
const ORG_B = organizationId('org-page-edits-0000-0000-000000000002')
const PROPERTY = 'e3100000-0000-4000-8000-000000000001'
const PORTAL_PUBLISHED = 'e3200000-0000-4000-8000-000000000001'
const PORTAL_DRAFT = 'e3200000-0000-4000-8000-000000000002'
const ACTOR = 'actor-page-edits-0000-000000000001'
const OTHER_ACTOR = 'actor-page-edits-0000-000000000002'
const NOW = new Date('2026-10-01T10:00:00.000Z')
const SNAPSHOT = 'e3400000-0000-4000-8000-000000000001'
const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_page_edits',
    'portal_pending_content_changes',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portals',
    'properties',
  ],
})

const query = (text: string, values: readonly unknown[] = []) =>
  getPool().query(text, [...values])

beforeEach(async () => {
  await query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Edit House', 'edit-house', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, NOW],
  )
  for (const [id, slug] of [
    [PORTAL_PUBLISHED, 'published'],
    [PORTAL_DRAFT, 'draft'],
  ] as const) {
    await query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3, 'property', $6, $4, $4, $5, $5)`,
      [id, ORG_A, PROPERTY, slug, NOW, PROPERTY],
    )
  }
  await query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [SNAPSHOT, ORG_A, PROPERTY, PORTAL_PUBLISHED, 'a'.repeat(64), NOW, ACTOR],
  )
})

const ledger = async () =>
  (
    await query(
      `SELECT portal_id::text AS portal_id, change_kind, change_key, actor_user_id,
              occurred_at, previous_text, new_text, edit_count
         FROM portal_page_edits WHERE organization_id = $1
        ORDER BY portal_id NULLS FIRST, change_kind, change_key, occurred_at`,
      [ORG_A],
    )
  ).rows

const pending = async () =>
  (
    await query(
      `SELECT portal_id::text AS portal_id, change_kind, change_key
         FROM portal_pending_content_changes WHERE organization_id = $1`,
      [ORG_A],
    )
  ).rows

const pendingChangedBy = async () =>
  (
    await query(
      `SELECT change_key, changed_by FROM portal_pending_content_changes
        WHERE organization_id = $1 ORDER BY changed_at, change_key`,
      [ORG_A],
    )
  ).rows

/** A publication of the Portal (its activation) at an instant. */
const activate = (portalId: string, at: Date, sequence: number) =>
  query(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id, activation_sequence,
       kind, activated_by, activated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'publish', $7, $8)`,
    [randomUUID(), ORG_A, PROPERTY, portalId, SNAPSHOT, sequence, ACTOR, at],
  )

type Save = Partial<Parameters<typeof recordPortalPageEdit>[1]>

/** One save of one part of the page; the defaults are a link rename by ACTOR at NOW. */
const save = (overrides: Save = {}) =>
  getDb().transaction((tx) =>
    recordPortalPageEdit(tx, {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: PORTAL_PUBLISHED,
      kind: 'portal_links',
      key: 'link:e3500000-0000-4000-8000-000000000001:updated',
      actorUserId: ACTOR,
      occurredAt: NOW,
      ...overrides,
    }),
  )

const write = <T>(
  work: (
    tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  ) => Promise<T>,
) => getDb().transaction(work)

describe('recordPortalPageEdit', () => {
  it('writes one row for a Portal, even one that was never published', async () => {
    const written = await write((tx) =>
      recordPortalPageEdit(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL_DRAFT,
        kind: 'portal_links',
        key: 'linktree:enabled',
        actorUserId: ACTOR,
        occurredAt: NOW,
      }),
    )

    expect(written).toBe(1)
    expect(await ledger()).toEqual([
      {
        portal_id: PORTAL_DRAFT,
        change_kind: 'portal_links',
        change_key: 'linktree:enabled',
        actor_user_id: ACTOR,
        occurred_at: NOW,
        previous_text: null,
        new_text: null,
        edit_count: 1,
      },
    ])
  })

  it('writes one row per Portal a shared record reaches, and none when it reaches none', async () => {
    await write(async (tx) => {
      await recordPortalPageEdit(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalIds: [PORTAL_PUBLISHED, PORTAL_DRAFT, PORTAL_DRAFT],
        kind: 'approved_destination',
        key: 'e3300000-0000-4000-8000-000000000001',
        actorUserId: null,
        occurredAt: NOW,
      })
      await recordPortalPageEdit(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalIds: [],
        kind: 'approved_destination',
        actorUserId: ACTOR,
        occurredAt: NOW,
      })
    })

    const rows = await ledger()
    expect(rows.map((row) => row.portal_id).sort()).toEqual([
      PORTAL_PUBLISHED,
      PORTAL_DRAFT,
    ])
    expect(rows.every((row) => row.actor_user_id === null)).toBe(true)
  })

  it('writes a single Property row, with no Portal, for the look and welcome text', async () => {
    await write(async (tx) => {
      await recordPortalPageEdit(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        kind: 'property_brand_profile',
        key: 'look:accent',
        actorUserId: ACTOR,
        occurredAt: NOW,
      })
      await recordPortalPageEdit(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL_PUBLISHED,
        kind: 'property_brand_content',
        key: 'es',
        actorUserId: ACTOR,
        occurredAt: NOW,
      })
    })

    expect((await ledger()).map((row) => [row.portal_id, row.change_kind])).toEqual([
      [null, 'property_brand_content'],
      [null, 'property_brand_profile'],
    ])
  })

  it('refuses a Portal-scoped edit that names no Portal, and a key past its storage limit', async () => {
    await expect(
      write((tx) =>
        recordPortalPageEdit(tx, {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          kind: 'portal_links',
          actorUserId: ACTOR,
          occurredAt: NOW,
        }),
      ),
    ).rejects.toThrow(/must name its Portal/)
    await expect(
      write((tx) =>
        recordPortalPageEdit(tx, {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalId: PORTAL_DRAFT,
          kind: 'portal_links',
          key: 'k'.repeat(161),
          actorUserId: ACTOR,
          occurredAt: NOW,
        }),
      ),
    ).rejects.toThrow(/storage contract/)
    expect(await ledger()).toEqual([])
  })

  it('is refused by the database for a Portal of another Property or Organization', async () => {
    const sibling = 'e3100000-0000-4000-8000-000000000002'
    await query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Sibling House', 'sibling-house', 'UTC', $3, $3)`,
      [sibling, ORG_A, NOW],
    )
    await expect(
      query(
        `INSERT INTO portal_page_edits (organization_id, property_id, portal_id, change_kind, occurred_at)
         VALUES ($1, $2, $3, 'portal_links', $4)`,
        [ORG_A, sibling, PORTAL_PUBLISHED, NOW],
      ),
    ).rejects.toThrow(/portal_page_edits_portal_tenant_fk/)
    await expect(
      query(
        `INSERT INTO portal_page_edits (organization_id, property_id, portal_id, change_kind, occurred_at)
         VALUES ($1, $2, $3, 'portal_links', $4)`,
        [ORG_B, PROPERTY, PORTAL_PUBLISHED, NOW],
      ),
    ).rejects.toThrow(/portal_page_edits_(property|portal)_tenant_fk/)
  })

  it('is refused by the database when a Property-wide kind names a Portal, or the reverse', async () => {
    await expect(
      query(
        `INSERT INTO portal_page_edits (organization_id, property_id, portal_id, change_kind, occurred_at)
         VALUES ($1, $2, $3, 'property_brand_profile', $4)`,
        [ORG_A, PROPERTY, PORTAL_PUBLISHED, NOW],
      ),
    ).rejects.toThrow(/portal_page_edits_scope/)
    await expect(
      query(
        `INSERT INTO portal_page_edits (organization_id, property_id, change_kind, occurred_at)
         VALUES ($1, $2, 'portal_links', $3)`,
        [ORG_A, PROPERTY, NOW],
      ),
    ).rejects.toThrow(/portal_page_edits_scope/)
  })
})

describe('recordPortalPageEdit wording', () => {
  it('keeps the text before and after a change of wording', async () => {
    await save({ previousText: 'Dinner menu', newText: 'Olive Terrace menu' })

    expect(await ledger()).toMatchObject([
      { previous_text: 'Dinner menu', new_text: 'Olive Terrace menu', edit_count: 1 },
    ])
  })

  it('clips wording past the bound instead of refusing the edit', async () => {
    await save({ previousText: 'p'.repeat(500), newText: 'n'.repeat(500) })

    const [row] = await ledger()
    expect(row?.previous_text).toHaveLength(200)
    expect(row?.new_text).toHaveLength(200)
  })

  it('refuses wording on a change that is not one, and the database refuses it too', async () => {
    await expect(
      save({ key: 'categories:reordered', newText: 'Dinner menu' }),
    ).rejects.toThrow(/must not carry wording/)
    await expect(
      save({
        kind: 'approved_destination',
        key: 'e3300000-0000-4000-8000-000000000001',
        previousText: 'x',
      }),
    ).rejects.toThrow(/must not carry wording/)
    for (const [kind, key] of [
      ['property_brand_profile', 'look:accent'],
      ['portal_links', 'links:e3500000-0000-4000-8000-000000000001:reordered'],
      ['portal_links', 'linktree:enabled'],
      ['portal_configuration', 'settings:theme'],
    ] as const) {
      await expect(
        query(
          `INSERT INTO portal_page_edits (organization_id, property_id, portal_id, change_kind, change_key, new_text, occurred_at)
           VALUES ($1, $2, $3, $4, $5, 'text', $6)`,
          [
            ORG_A,
            PROPERTY,
            kind === 'property_brand_profile' ? null : PORTAL_DRAFT,
            kind,
            key,
            NOW,
          ],
        ),
        `${kind}/${key}`,
      ).rejects.toThrow(/portal_page_edits_text_scope/)
    }
    expect(await ledger()).toEqual([])
  })
})

describe('recordPortalPageEdit folding', () => {
  it('folds saves of one part by one person into one row: the first before, the latest after', async () => {
    await save({ previousText: 'Dinner', newText: 'Dinner m', occurredAt: NOW })
    await save({
      previousText: 'Dinner m',
      newText: 'Dinner menu',
      occurredAt: minutesAfter(1),
    })
    await save({
      previousText: 'Dinner menu',
      newText: 'Olive menu',
      occurredAt: minutesAfter(2),
    })

    expect(await ledger()).toMatchObject([
      {
        previous_text: 'Dinner',
        new_text: 'Olive menu',
        edit_count: 3,
        occurred_at: minutesAfter(2),
      },
    ])
  })

  it('keeps the latest wording when a later save of the same part changed none', async () => {
    await save({ previousText: 'Dinner', newText: 'Olive menu' })
    await save({ occurredAt: minutesAfter(1) })

    expect(await ledger()).toMatchObject([
      { previous_text: 'Dinner', new_text: 'Olive menu', edit_count: 2 },
    ])
  })

  it('adopts the first wording that comes when the row began as a save with none', async () => {
    await save()
    await save({
      previousText: 'Dinner menu',
      newText: 'Olive menu',
      occurredAt: minutesAfter(1),
    })

    expect(await ledger()).toMatchObject([
      { previous_text: 'Dinner menu', new_text: 'Olive menu', edit_count: 2 },
    ])
  })

  it('keeps "there was none before" as the before when a first title is later cleared', async () => {
    await save({ previousText: null, newText: 'Around town' })
    await save({
      previousText: 'Around town',
      newText: null,
      occurredAt: minutesAfter(1),
    })

    expect(await ledger()).toMatchObject([
      { previous_text: null, new_text: null, edit_count: 2 },
    ])
  })

  it('starts a new row once a publication has come between two saves', async () => {
    await save({ occurredAt: NOW })
    await save({ occurredAt: minutesAfter(1) })
    await activate(PORTAL_PUBLISHED, minutesAfter(2), 1)
    await save({ occurredAt: minutesAfter(3) })

    expect(await ledger()).toMatchObject([
      { edit_count: 2, occurred_at: minutesAfter(1) },
      { edit_count: 1, occurred_at: minutesAfter(3) },
    ])
  })

  it('does not fold a save that shares an instant with a later publication', async () => {
    await save({ occurredAt: NOW })
    await activate(PORTAL_PUBLISHED, NOW, 1)
    await save({ occurredAt: minutesAfter(1) })

    expect((await ledger()).map((row) => row.edit_count)).toEqual([1, 1])
  })

  it('does not fold saves of a different part, by a different person or past the window', async () => {
    await save()
    await save({ key: 'link:e3500000-0000-4000-8000-000000000002:updated' })
    await save({ actorUserId: OTHER_ACTOR })
    await save({ actorUserId: null })
    await save({
      occurredAt: new Date(NOW.getTime() + PORTAL_PAGE_EDIT_FOLD_WINDOW_MS + 1),
    })

    expect((await ledger()).map((row) => row.edit_count)).toEqual([1, 1, 1, 1, 1])
  })

  it('folds saves of a Portal that was never published, and keeps Portals apart', async () => {
    await save({ portalId: PORTAL_DRAFT })
    await save({ portalId: PORTAL_DRAFT, occurredAt: minutesAfter(1) })
    await save({ portalId: PORTAL_PUBLISHED, occurredAt: minutesAfter(1) })

    expect((await ledger()).map((row) => [row.portal_id, row.edit_count]).sort()).toEqual(
      [
        [PORTAL_PUBLISHED, 1],
        [PORTAL_DRAFT, 2],
      ].sort(),
    )
  })

  it('folds the system into its own earlier row, not into a person', async () => {
    await save({ actorUserId: null })
    await save({ actorUserId: null, occurredAt: minutesAfter(1) })

    expect((await ledger()).map((row) => [row.actor_user_id, row.edit_count])).toEqual([
      [null, 2],
    ])
  })

  it('folds a Property-wide edit until any Portal of the Property is published', async () => {
    const wide = {
      kind: 'property_brand_profile',
      key: 'look:accent',
      portalId: undefined,
    } as const
    await save(wide)
    await save({ ...wide, occurredAt: minutesAfter(1) })
    await activate(PORTAL_PUBLISHED, minutesAfter(2), 1)
    await save({ ...wide, occurredAt: minutesAfter(3) })

    expect((await ledger()).map((row) => row.edit_count)).toEqual([2, 1])
  })

  it('folds once per Portal when a shared record reaches several', async () => {
    const shared = {
      kind: 'approved_destination',
      key: 'e3300000-0000-4000-8000-000000000001',
      portalId: undefined,
      portalIds: [PORTAL_PUBLISHED, PORTAL_DRAFT],
    } as const
    await save(shared)
    await save({ ...shared, occurredAt: minutesAfter(1) })

    expect((await ledger()).map((row) => row.edit_count)).toEqual([2, 2])
  })
})

describe('portal_page_edits tenant fence', () => {
  it('refuses a Property-wide row whose Organization does not own the Property', async () => {
    await expect(
      query(
        `INSERT INTO portal_page_edits (organization_id, property_id, change_kind, change_key, occurred_at)
         VALUES ($1, $2, 'property_brand_profile', 'look:accent', $3)`,
        [ORG_B, PROPERTY, NOW],
      ),
    ).rejects.toThrow(/portal_page_edits_property_tenant_fk/)
  })

  it('refuses an edit count below one', async () => {
    await expect(
      query(
        `INSERT INTO portal_page_edits (organization_id, property_id, portal_id, change_kind, edit_count, occurred_at)
         VALUES ($1, $2, $3, 'portal_links', 0, $4)`,
        [ORG_A, PROPERTY, PORTAL_DRAFT, NOW],
      ),
    ).rejects.toThrow(/portal_page_edits_count_positive/)
  })
})

describe('recordPortalContentChange', () => {
  it('opens the pending fence only for a published Portal but records the edit for both', async () => {
    const opened = await write((tx) =>
      recordPortalContentChange(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalIds: [PORTAL_PUBLISHED, PORTAL_DRAFT],
        kind: 'portal_localized_override',
        key: 'es',
        ledger: [{ key: 'es', previousText: 'Pool area', newText: 'Pool and terrace' }],
        sourceVersion: 'v1',
        changedAt: NOW,
        actorUserId: ACTOR,
      }),
    )

    expect(opened).toBe(1)
    expect(await pending()).toEqual([
      {
        portal_id: PORTAL_PUBLISHED,
        change_kind: 'portal_localized_override',
        change_key: 'es',
      },
    ])
    expect((await ledger()).map((row) => row.portal_id).sort()).toEqual([
      PORTAL_PUBLISHED,
      PORTAL_DRAFT,
    ])
  })

  it('keeps its own ledger key apart from the fence key, one ledger row per entry', async () => {
    await write((tx) =>
      recordPortalContentChange(tx, {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PORTAL_PUBLISHED,
        kind: 'portal_links',
        ledger: [
          { key: 'link:e3500000-0000-4000-8000-000000000001:created', newText: 'Menu' },
          { key: 'categories:reordered' },
        ],
        sourceVersion: 'v1',
        changedAt: NOW,
        actorUserId: ACTOR,
      }),
    )

    expect(await pending()).toEqual([
      { portal_id: PORTAL_PUBLISHED, change_kind: 'portal_links', change_key: 'all' },
    ])
    expect((await ledger()).map((row) => row.change_key)).toEqual([
      'categories:reordered',
      'link:e3500000-0000-4000-8000-000000000001:created',
    ])
  })

  it('keeps no ledger row when the transaction rolls back', async () => {
    await expect(
      write(async (tx) => {
        await recordPortalContentChange(tx, {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalId: PORTAL_PUBLISHED,
          kind: 'portal_links',
          ledger: [{ key: 'categories:reordered' }],
          sourceVersion: 'v1',
          changedAt: NOW,
          actorUserId: ACTOR,
        })
        throw new Error('later step failed')
      }),
    ).rejects.toThrow('later step failed')
    expect(await ledger()).toEqual([])
    expect(await pending()).toEqual([])
  })

  it('records who opened each fence row, and null when the system did', async () => {
    const open = (actorUserId: string | null, sourceVersion: string, key: string) =>
      write((tx) =>
        recordPortalContentChange(tx, {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalId: PORTAL_PUBLISHED,
          kind: 'portal_links',
          key,
          ledger: [],
          sourceVersion,
          changedAt: NOW,
          actorUserId,
        }),
      )
    await open(ACTOR, 'v1', 'person')
    await open(null, 'v1', 'system')

    expect(await pendingChangedBy()).toEqual([
      { change_key: 'person', changed_by: ACTOR },
      { change_key: 'system', changed_by: null },
    ])
  })

  it('keeps the first person when the same revision is recorded twice', async () => {
    const open = (actorUserId: string) =>
      write((tx) =>
        recordPortalContentChange(tx, {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalId: PORTAL_PUBLISHED,
          kind: 'portal_links',
          ledger: [],
          sourceVersion: 'v1',
          changedAt: NOW,
          actorUserId,
        }),
      )
    expect(await open(ACTOR)).toBe(1)
    expect(await open(OTHER_ACTOR)).toBe(0)

    expect(await pendingChangedBy()).toEqual([{ change_key: 'all', changed_by: ACTOR }])
  })
})
