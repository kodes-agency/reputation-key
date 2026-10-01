// Portal working copy (F4): publish, the in-transaction verification and the
// history comparison must all see one working copy. These tests seed the rows
// by SQL and pin what the working copy is (golden), then prove that each of
// the three consumers agrees with it, and that they all notice the same drift.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { userId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getPortalPublicationHistory } from '../application/use-cases/get-portal-publication-history'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import { portalPublicationPublished, portalUpdated } from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import {
  lockPortalWorkingCopyTables,
  readPortalWorkingCopy,
} from './portal-working-copy.reader'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { seedPortalWorkingCopy } from './testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  INCOMPLETE_SCENARIO,
  NO_BRAND_SCENARIO,
  SCENARIO_HERO_ASSET,
  SCENARIO_TILE_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
  type WorkingCopyScenario,
} from './testing/portal-working-copy-scenarios'
import {
  COMPLETE_GOLDEN,
  INCOMPLETE_GOLDEN,
  NO_BRAND_GOLDEN,
} from './__fixtures__/portal-working-copy.golden'

const MANAGER = userId('manager-workingcopy-0000000000001')
const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T11:00:00.000Z')
const EDITED_AT = new Date('2026-08-26T12:00:00.000Z')
const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=working-copy',
  retrievedAt: SEEDED_AT,
  sourceEpoch: 1,
  profileVersion: 1,
} as const

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

/** The working copy as publish reads it: through the publication repository. */
const publishRead = (scenario: WorkingCopyScenario) =>
  createPortalPublicationRepository(getDb()).loadWorkingCopy(
    scenario.organizationId,
    scenario.portalId,
  )

async function publishFrom(
  scenario: WorkingCopyScenario,
  source: PortalPublicationSource,
): Promise<void> {
  const snapshot = buildPortalPublicationSnapshot({
    id: '6d000000-0000-4000-8000-000000000001',
    portalId: scenario.portalId,
    organizationId: scenario.organizationId,
    propertyId: scenario.propertyId,
    version: 1,
    source,
    destination: DESTINATION,
    createdBy: MANAGER,
    createdAt: PUBLISHED_AT,
  })
  await createAtomicPortalCommandStore(getDb()).updatePortal({
    organizationId: scenario.organizationId,
    propertyId: scenario.propertyId,
    portalId: scenario.portalId,
    actorUserId: MANAGER,
    expectedUpdatedAt: SEEDED_AT,
    revision: PUBLISHED_AT,
    occurredAt: PUBLISHED_AT,
    patch: { publicationState: 'published' },
    publication: {
      kind: 'publish',
      snapshot,
      activation: {
        id: '6e000000-0000-4000-8000-000000000001',
        organizationId: scenario.organizationId,
        propertyId: scenario.propertyId,
        portalId: scenario.portalId,
        snapshotId: snapshot.id,
        activationSequence: 1,
        kind: 'publish',
        activatedBy: MANAGER,
        activatedAt: PUBLISHED_AT,
        deactivatedAt: null,
        deactivationReason: null,
      },
    },
    lifecycleEvent: portalPublicationPublished({
      organizationId: scenario.organizationId,
      propertyId: scenario.propertyId,
      portalId: scenario.portalId,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      userId: MANAGER,
      sourceAggregateVersion: PUBLISHED_AT.toISOString(),
      occurredAt: PUBLISHED_AT,
    }),
    event: portalUpdated({
      portalId: scenario.portalId,
      organizationId: scenario.organizationId,
      propertyId: scenario.propertyId,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: PUBLISHED_AT.toISOString(),
      occurredAt: PUBLISHED_AT,
    }),
  })
}

async function snapshotCount(): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS count FROM portal_publication_snapshots WHERE organization_id = $1`,
    [WORKING_COPY_ORG],
  )
  return rows[0].count
}

async function historyHasPendingChanges(scenario: WorkingCopyScenario): Promise<boolean> {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([
    buildTestPortal({
      id: scenario.portalId,
      organizationId: scenario.organizationId,
      propertyId: scenario.propertyId,
      publicationState: 'published',
    }),
  ])
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  const history = await getPortalPublicationHistory({
    portalRepo,
    publicationRepo: createPortalPublicationRepository(getDb()),
    staffPublicApi,
    actorDirectory: { resolveDisplayNames: async () => new Map() },
  })(
    { portalId: scenario.portalId },
    buildTestAuthContext({ organizationId: scenario.organizationId }),
  )
  return history.hasPendingChanges
}

describe.sequential('Portal working copy (real PostgreSQL)', () => {
  it.each([
    ['a complete localized experience', COMPLETE_SCENARIO, COMPLETE_GOLDEN],
    ['a Portal with no Brand Profile', NO_BRAND_SCENARIO, NO_BRAND_GOLDEN],
    ['a language with no wording', INCOMPLETE_SCENARIO, INCOMPLETE_GOLDEN],
  ])('reads %s exactly as pinned', async (_name, scenario, golden) => {
    await seedPortalWorkingCopy(getPool(), scenario)

    await expect(publishRead(scenario)).resolves.toEqual(golden)
  })

  it('reads the same working copy inside a locked transaction as outside it', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    const scope = {
      organizationId: COMPLETE_SCENARIO.organizationId,
      propertyId: COMPLETE_SCENARIO.propertyId,
      portalId: COMPLETE_SCENARIO.portalId,
    }

    const inTransaction = await getDb().transaction(async (tx) => {
      await lockPortalWorkingCopyTables(tx)
      return readPortalWorkingCopy(tx, scope)
    })

    expect(inTransaction).toEqual(COMPLETE_GOLDEN)
    await expect(readPortalWorkingCopy(getDb(), scope)).resolves.toEqual(inTransaction)
    await expect(publishRead(COMPLETE_SCENARIO)).resolves.toEqual(inTransaction)
  })

  it('does not resolve a Portal under another Property', async () => {
    await seedPortalWorkingCopy(getPool(), NO_BRAND_SCENARIO)

    await expect(
      readPortalWorkingCopy(getDb(), {
        organizationId: NO_BRAND_SCENARIO.organizationId,
        propertyId: COMPLETE_SCENARIO.propertyId,
        portalId: NO_BRAND_SCENARIO.portalId,
      }),
    ).resolves.toBeNull()
  })

  it('does not resolve a Portal for another organisation or once it is deleted', async () => {
    await seedPortalWorkingCopy(getPool(), NO_BRAND_SCENARIO)

    await expect(
      createPortalPublicationRepository(getDb()).loadWorkingCopy(
        WORKING_COPY_OTHER_ORG,
        NO_BRAND_SCENARIO.portalId,
      ),
    ).resolves.toBeNull()
    await getPool().query(`UPDATE portals SET deleted_at = NOW() WHERE id = $1`, [
      NO_BRAND_SCENARIO.portalId,
    ])
    await expect(publishRead(NO_BRAND_SCENARIO)).resolves.toBeNull()
  })

  it('commits a publication built from the working copy and reports no pending change', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    const source = await publishRead(COMPLETE_SCENARIO)

    await publishFrom(COMPLETE_SCENARIO, source!)

    await expect(snapshotCount()).resolves.toBe(1)
    await expect(historyHasPendingChanges(COMPLETE_SCENARIO)).resolves.toBe(false)
  })

  it('reads back, through the repository, exactly the v3 snapshot it committed', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    const source = await publishRead(COMPLETE_SCENARIO)
    await publishFrom(COMPLETE_SCENARIO, source!)

    const active = await createPortalPublicationRepository(getDb()).findActiveForPortal(
      COMPLETE_SCENARIO.organizationId,
      COMPLETE_SCENARIO.portalId,
    )

    // snapshotFromRow parses the stored JSON and verifies it, so a null here is a
    // v3 shape the reader would refuse: the portal would be unavailable.
    expect(active?.configuration).toMatchObject({
      schemaVersion: 3,
      guestLocale: 'bg',
      languagePackVersion: 'guest-ui-bg-v2',
      localeSet: ['bg', 'en'],
      timeZone: 'Europe/Sofia',
      brandProfile: { wordmark: 'RILA', lookVersion: 4 },
      // English had no photo description of its own: copied from Bulgarian, tagged.
      localizedContent: {
        en: { heroAlt: { value: 'Фасадата на хотела', fallbackFrom: 'bg' } },
      },
      provenance: {
        aiDraftTextKeys: ['link:c4000000-0000-4000-8000-000000000001:text:en'],
      },
    })
    expect(active?.configuration).toHaveProperty(
      'links.0.id',
      'c4000000-0000-4000-8000-000000000002',
    )
  })

  it('commits a publication of a Portal whose Property has no Brand Profile', async () => {
    await seedPortalWorkingCopy(getPool(), NO_BRAND_SCENARIO)
    const source = await publishRead(NO_BRAND_SCENARIO)

    await publishFrom(NO_BRAND_SCENARIO, source!)

    await expect(snapshotCount()).resolves.toBe(1)
    await expect(historyHasPendingChanges(NO_BRAND_SCENARIO)).resolves.toBe(false)
  })

  it('publishes a language with no wording as copies of the primary language', async () => {
    await seedPortalWorkingCopy(getPool(), INCOMPLETE_SCENARIO)
    const source = await publishRead(INCOMPLETE_SCENARIO)

    await publishFrom(INCOMPLETE_SCENARIO, source!)

    const { rows } = await getPool().query(
      `SELECT configuration->'localizedContent'->'bg'->'title' AS title
         FROM portal_publication_snapshots WHERE organization_id = $1`,
      [WORKING_COPY_ORG],
    )
    expect(rows[0].title).toEqual({ value: 'Hotel Pirin', fallbackFrom: 'en' })
  })

  it('does not count a Portal override on a language whose row holds only a photograph description', async () => {
    const scenario: WorkingCopyScenario = {
      ...INCOMPLETE_SCENARIO,
      contents: [
        ...INCOMPLETE_SCENARIO.contents,
        { locale: 'bg', title: '', shortDescription: '', heroAltText: 'Басейн' },
      ],
      overrides: [
        {
          locale: 'bg',
          title: 'Хотел Пирин',
          shortDescription: null,
          heroImageUrl: null,
        },
      ],
    }
    await seedPortalWorkingCopy(getPool(), scenario)

    const source = await publishRead(scenario)

    expect(source?.wording.bg).toMatchObject({
      title: null,
      shortDescription: null,
      heroAlt: 'Басейн',
    })
  })

  it('leaves out an image that has been taken down', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    await getPool().query(
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW()
        WHERE id IN ($1, $2)`,
      [SCENARIO_HERO_ASSET, SCENARIO_TILE_ASSET],
    )

    const source = await publishRead(COMPLETE_SCENARIO)

    expect(source?.look?.hero).toBeNull()
    expect(source?.look?.logo).not.toBeNull()
    expect(source?.links.map((link) => link.imageAssetId)).toEqual([null, null])
  })

  it('reads the stored text, never the link label, when the two differ', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    // Nothing writes the legacy label any more: when it differs from the text
    // the text, which every editor writes, is the wording.
    await getPool().query(
      `UPDATE portal_links SET label = 'An older label', updated_at = $1
        WHERE id = 'c4000000-0000-4000-8000-000000000001'`,
      [EDITED_AT],
    )

    const source = await publishRead(COMPLETE_SCENARIO)

    const menu = source?.links.find(
      (link) => link.id === 'c4000000-0000-4000-8000-000000000001',
    )
    expect(menu?.texts.bg).toEqual({
      label: 'Меню',
      line: 'Закуска до 11',
      provenance: null,
    })
    expect(menu?.texts.en?.label).toBe('Menu')
  })

  it('lists links in the order of their category, then their own', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    await getPool().query(
      `INSERT INTO portal_link_categories
         (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
       VALUES ('c3000000-0000-4000-8000-0000000000f1', $1, $2, 'Earlier', 'Z', NOW(), NOW())`,
      [COMPLETE_SCENARIO.portalId, WORKING_COPY_ORG],
    )
    // Moved into a category that sorts before the one it was seeded in.
    await getPool().query(
      `UPDATE portal_links SET category_id = 'c3000000-0000-4000-8000-0000000000f1'
        WHERE id = 'c4000000-0000-4000-8000-000000000001'`,
    )
    await getPool().query(
      `UPDATE portal_link_categories SET sort_key = 'a-' WHERE id = 'c3000000-0000-4000-8000-0000000000f1'`,
    )

    const source = await publishRead(COMPLETE_SCENARIO)

    expect(source?.links.map((link) => link.id)).toEqual([
      'c4000000-0000-4000-8000-000000000001',
      'c4000000-0000-4000-8000-000000000002',
    ])
  })

  // One mutation for every v3 field a guest could see: each must stop a
  // snapshot of the earlier working copy from being committed.
  it.each([
    [
      'a link text',
      `UPDATE portal_link_texts SET label = 'Renamed' WHERE label = 'Меню'`,
    ],
    [
      'where a link text came from',
      `UPDATE portal_link_texts SET provenance = NULL WHERE provenance = 'ai_draft'`,
    ],
    [
      'a link icon',
      `UPDATE portal_links SET icon_key = 'coffee' WHERE id = 'c4000000-0000-4000-8000-000000000001'`,
    ],
    [
      'a tile picture',
      `UPDATE portal_links SET image_asset_id = NULL WHERE id = 'c4000000-0000-4000-8000-000000000002'`,
    ],
    [
      'an approved destination',
      `UPDATE portal_approved_destinations
         SET approval_state = 'disabled', approved_by = NULL, approved_at = NULL
       WHERE normalized_uri = 'https://example.com/menu'`,
    ],
    [
      'the Brand Profile name',
      `UPDATE property_portal_brand_profiles SET display_name = 'Renamed' WHERE property_id = '${COMPLETE_SCENARIO.propertyId}'`,
    ],
    [
      'the look version',
      `UPDATE property_portal_brand_profiles SET look_version = look_version + 1 WHERE property_id = '${COMPLETE_SCENARIO.propertyId}'`,
    ],
    [
      'the wordmark',
      `UPDATE property_portal_brand_profiles SET wordmark = 'OTHER' WHERE property_id = '${COMPLETE_SCENARIO.propertyId}'`,
    ],
    [
      'the hero focal point',
      `UPDATE property_portal_brand_profiles SET hero_focal_x = 0.9 WHERE property_id = '${COMPLETE_SCENARIO.propertyId}'`,
    ],
    [
      'the hero photo being taken down',
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW() WHERE id = '${SCENARIO_HERO_ASSET}'`,
    ],
    [
      'a locale override',
      `UPDATE portal_localized_overrides SET title = 'Renamed' WHERE locale = 'en'`,
    ],
    [
      'a Linktree title',
      `UPDATE portal_localized_overrides SET linktree_title = 'Renamed' WHERE locale = 'en'`,
    ],
    [
      'a brand content title',
      `UPDATE property_portal_brand_contents SET title = 'Renamed' WHERE locale = 'bg'`,
    ],
    [
      'the photo description',
      `UPDATE property_portal_brand_contents SET hero_alt_text = 'Renamed' WHERE locale = 'bg'`,
    ],
    [
      'the Linktree switch',
      `UPDATE portals SET linktree_enabled = false WHERE id = '${COMPLETE_SCENARIO.portalId}'`,
    ],
    [
      'the Property time zone',
      `UPDATE properties SET timezone = 'Europe/London' WHERE id = '${COMPLETE_SCENARIO.propertyId}'`,
    ],
  ])('refuses to commit a snapshot when %s changes first', async (_name, mutation) => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    const source = await publishRead(COMPLETE_SCENARIO)

    await getPool().query(mutation)

    await expect(publishFrom(COMPLETE_SCENARIO, source!)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
    await expect(snapshotCount()).resolves.toBe(0)
  })

  it('reports a pending change once the working copy moves past the published one', async () => {
    await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
    const source = await publishRead(COMPLETE_SCENARIO)
    await publishFrom(COMPLETE_SCENARIO, source!)

    await getPool().query(
      `UPDATE portal_link_texts SET label = 'Renamed', updated_at = $1 WHERE label = 'Меню'`,
      [EDITED_AT],
    )

    await expect(historyHasPendingChanges(COMPLETE_SCENARIO)).resolves.toBe(true)
  })
})
