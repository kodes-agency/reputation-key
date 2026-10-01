// The picture on a link tile (round 4, slice 42c1) against real PostgreSQL: the
// update command writes and clears `image_asset_id`, the working model reads it
// back, the composite foreign key keeps a tile to its own Property's assets, and
// the edit is a pending change like any other.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal, buildTestPortalLink } from '#/shared/testing/fixtures'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  portalMediaAssetId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { portalCreated, portalLinkCreated, portalLinkUpdated } from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { createPortalLinkRepository } from './repositories/portal-link.repository'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'

const ORG_A = organizationId('org-tileimg-0000-0000-000000000001')
const ORG_B = organizationId('org-tileimg-0000-0000-000000000002')
const PROPERTY_A = propertyId('9a000000-0000-4000-8000-000000000001')
const PROPERTY_A2 = propertyId('9a000000-0000-4000-8000-000000000002')
const PORTAL_A = portalId('9b000000-0000-4000-8000-000000000001')
const CATEGORY_A = portalLinkCategoryId('9c000000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-tileimg-0000000000000001')
const CREATED_AT = new Date('2026-10-01T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_publication_snapshots',
    'portal_link_texts',
    'portal_localized_overrides',
    'portal_links',
    'portal_link_categories',
    'portal_page_edits',
    'portal_media_assets',
    'portal_responsible_managers',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const store = () => createAtomicPortalCommandStore(getDb())
const links = () => createPortalLinkRepository(getDb(), () => CREATED_AT)

let tickCount = 0
const nextInstant = () => new Date(CREATED_AT.getTime() + (tickCount += 1) * 1000)

async function base() {
  const revision = nextInstant()
  const { rows } = await getPool().query(
    `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
    [ORG_A, PORTAL_A],
  )
  return {
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    expectedPortalUpdatedAt: rows[0].updated_at as Date,
    revision,
    occurredAt: revision,
  }
}

async function createTile() {
  const command = await base()
  const id = portalLinkId(randomUUID())
  await store().createPortalLink({
    ...command,
    actorUserId: MANAGER,
    link: buildTestPortalLink({
      id,
      categoryId: CATEGORY_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      label: 'Discover the resort',
      url: `https://example.test/${id}`,
      iconKey: 'waves',
      sortKey: 'a0',
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt,
    }),
    event: portalLinkCreated({
      portalId: PORTAL_A,
      linkId: id,
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
  return id
}

async function setImage(linkId: string, imageAssetId: string | null) {
  const command = await base()
  await store().updatePortalLink({
    ...command,
    actorUserId: MANAGER,
    linkId: portalLinkId(linkId),
    categoryId: CATEGORY_A,
    patch: {
      label: 'Discover the resort',
      url: `https://example.test/${linkId}`,
      destinationId: null,
      legacyDestinationState: 'unclassified',
      iconKey: 'waves',
      imageAssetId: imageAssetId === null ? null : portalMediaAssetId(imageAssetId),
    },
    event: portalLinkUpdated({
      portalId: PORTAL_A,
      linkId: portalLinkId(linkId),
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

async function storedImage(linkId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT image_asset_id FROM portal_links WHERE organization_id = $1 AND id = $2`,
    [ORG_A, linkId],
  )
  return (rows[0]?.image_asset_id as string | null | undefined) ?? null
}

async function insertAsset(property = PROPERTY_A) {
  const asset = buildTestPortalMediaAsset({
    organizationId: ORG_A,
    propertyId: property,
    purpose: 'link_image',
    width: 1200,
    height: 800,
  })
  await createPortalMediaAssetRepository(getDb()).insert(asset)
  return asset
}

beforeEach(async () => {
  tickCount = 0
  clearEventSchemas()
  registerAllEventSchemas()
  const portal = buildTestPortal({
    id: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    entityId: PROPERTY_A,
    name: 'Reception',
    slug: 'reception',
    createdBy: MANAGER,
    primaryGuestLocale: 'en',
    additionalGuestLocales: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  for (const [id, slug] of [
    [PROPERTY_A, 'harbour-house'],
    [PROPERTY_A2, 'harbour-annex'],
  ] as const) {
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'UTC', $4, $4)`,
      [id, ORG_A, slug, CREATED_AT],
    )
  }
  await store().createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
  await getPool().query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
    [CATEGORY_A, PORTAL_A, ORG_A, CREATED_AT],
  )
})

describe('the picture on a link tile', () => {
  it('is written by the update command and read back with the link', async () => {
    const id = await createTile()
    const asset = await insertAsset()

    await setImage(id, asset.id)

    expect(await storedImage(id)).toBe(asset.id)
    expect((await links().findLinkById(ORG_A, portalLinkId(id)))?.imageAssetId).toBe(
      asset.id,
    )
  })

  it('is taken off by writing null, and the icon is untouched', async () => {
    const id = await createTile()
    const asset = await insertAsset()
    await setImage(id, asset.id)

    await setImage(id, null)

    expect(await storedImage(id)).toBeNull()
    const link = await links().findLinkById(ORG_A, portalLinkId(id))
    expect(link).toMatchObject({ imageAssetId: null, iconKey: 'waves' })
  })

  it('cannot name an asset of another Property, whatever the use case checked', async () => {
    const id = await createTile()
    const elsewhere = await insertAsset(PROPERTY_A2)

    await expect(setImage(id, elsewhere.id)).rejects.toMatchObject({
      cause: { constraint: 'portal_links_image_asset_fk' },
    })

    expect(await storedImage(id)).toBeNull()
  })

  it('cannot name an asset that does not exist', async () => {
    const id = await createTile()

    await expect(setImage(id, randomUUID())).rejects.toMatchObject({
      cause: { constraint: 'portal_links_image_asset_fk' },
    })
  })

  it('keeps the stored image from being deleted while the tile uses it', async () => {
    const id = await createTile()
    const asset = await insertAsset()
    await setImage(id, asset.id)

    await expect(
      getPool().query(`DELETE FROM portal_media_assets WHERE id = $1`, [asset.id]),
    ).rejects.toMatchObject({ constraint: 'portal_links_image_asset_fk' })
  })

  it('moves the working copy past what is published, like any other tile edit', async () => {
    const id = await createTile()
    await getPool().query(
      `INSERT INTO portal_publication_snapshots (
         id, organization_id, property_id, portal_id, version, configuration_digest,
         configuration, guest_locale, language_pack_version, private_feedback_threshold,
         destination_uri, destination_retrieved_at, destination_source_epoch,
         destination_profile_version, created_by, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
                 'https://example.test/review', $6, 0, 1, $7, $6)`,
      [randomUUID(), ORG_A, PROPERTY_A, PORTAL_A, 'a'.repeat(64), CREATED_AT, MANAGER],
    )
    const asset = await insertAsset()

    await setImage(id, asset.id)

    const { rows } = await getPool().query(
      `SELECT change_kind FROM portal_pending_content_changes WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(rows.map((row) => row.change_kind)).toContain('portal_links')
  })
})
