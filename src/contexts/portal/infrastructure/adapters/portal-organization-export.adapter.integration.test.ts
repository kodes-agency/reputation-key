import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createPortalOrganizationExportContributor } from './portal-organization-export.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const DIGEST = 'a'.repeat(64)

// Deleted innermost-first; every Portal foreign key is ON DELETE RESTRICT.
const CHILD_TABLES = [
  'portal_address_downloads',
  'portal_access_artifacts',
  'portal_tokens',
  'portal_pending_content_changes',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_health_intervals',
  'portal_responsible_managers',
  'portal_localized_overrides',
  'portal_link_texts',
  'portal_links',
  'portal_link_categories',
  'portal_group_members',
  'portal_group_history',
  'portal_groups',
  'portal_approved_destinations',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portal_media_assets',
  'portals',
  'properties',
] as const

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  groupId: string
  categoryId: string
  linkId: string
  mediaAssetId: string
  destinationId: string
  snapshotId: string
  activationId: string
  artifactId: string
  tokenId: string
  tokenIdentifier: string
  tokenHash: string
  userId: string
}>

async function seedOrganization(): Promise<string> {
  const organizationId = `portal-export-org-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Portal Export Fixture', $1, now())`,
    [organizationId],
  )
  return organizationId
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = await seedOrganization()
  const tokenId = randomUUID()
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    groupId: randomUUID(),
    categoryId: randomUUID(),
    linkId: randomUUID(),
    mediaAssetId: randomUUID(),
    destinationId: randomUUID(),
    snapshotId: randomUUID(),
    activationId: randomUUID(),
    artifactId: randomUUID(),
    tokenId,
    tokenIdentifier: randomUUID().replaceAll('-', '').slice(0, 24),
    tokenHash: 'f'.repeat(64),
    userId: `portal-export-user-${randomUUID()}`,
  }
  const q = (text: string, values: readonly unknown[]) =>
    lease.pool.query(text, [...values])

  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', now(), now())`,
    [fixture.propertyId, organizationId],
  )
  await q(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_id, name, slug, description,
       publication_state, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'Front Desk', 'front-desk', 'Lobby portal',
               'published', $5, now(), now())`,
    [
      fixture.portalId,
      organizationId,
      fixture.propertyId,
      fixture.propertyId,
      fixture.userId,
    ],
  )
  await q(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, sort_key,
                                created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Ground Floor', 'a', $4, now(), now())`,
    [fixture.groupId, organizationId, fixture.propertyId, fixture.userId],
  )
  await q(
    `INSERT INTO portal_group_history (id, organization_id, property_id, portal_group_id,
                                       kind, name, previous_name, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, $4, 'renamed', 'Ground Floor', 'Lobby Level', $5, now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.groupId, fixture.userId],
  )
  await q(
    `INSERT INTO portal_group_members (id, portal_group_id, portal_id, organization_id,
                                       created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [randomUUID(), fixture.groupId, fixture.portalId, organizationId],
  )
  await q(
    `INSERT INTO portal_approved_destinations (
       id, organization_id, property_id, normalized_uri, hostname, source_type,
       approval_state, validation_version, requested_by, approved_by, approved_at,
       last_validated_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'https://example.test/review', 'example.test', 'recognized',
               'approved', 'destination-validation-v1', $4, $4, now(), now(), now(), now())`,
    [fixture.destinationId, organizationId, fixture.propertyId, fixture.userId],
  )
  await q(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Recommended', 'a', now(), now())`,
    [fixture.categoryId, fixture.portalId, organizationId],
  )
  await q(
    `INSERT INTO portal_links (
       id, category_id, portal_id, organization_id, property_id, label,
       destination_id, legacy_destination_state, sort_key, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'Review us', $6, 'migrated', 'a', now(), now())`,
    [
      fixture.linkId,
      fixture.categoryId,
      fixture.portalId,
      organizationId,
      fixture.propertyId,
      fixture.destinationId,
    ],
  )
  await q(
    `INSERT INTO portal_link_texts (
       id, organization_id, property_id, portal_id, link_id, locale, label, line,
       version, updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'en', 'Review us', 'Two minutes', 1, $6, now(), now())`,
    [
      randomUUID(),
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      fixture.linkId,
      fixture.userId,
    ],
  )
  await q(
    `INSERT INTO portal_localized_overrides (
       id, organization_id, property_id, portal_id, locale, title, linktree_title,
       version, updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'bg', 'Рецепция', 'Полезни връзки', 1, $5, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalId, fixture.userId],
  )
  await q(
    `INSERT INTO portal_media_assets (
       id, organization_id, property_id, purpose, object_key, content_type, width,
       height, byte_size, content_sha256, source_format, source_bytes,
       rights_confirmed_at, created_by
     ) VALUES ($1::uuid, $2, $3, 'hero', 'portal-media/' || $1::text || '.webp', 'image/webp',
               2400, 1600, 180000, $5, 'jpeg', 2500000, now(), $4)`,
    [fixture.mediaAssetId, organizationId, fixture.propertyId, fixture.userId, DIGEST],
  )
  await q(
    `INSERT INTO property_portal_brand_profiles (
       id, organization_id, property_id, display_name, primary_color,
       background_color, text_color, wordmark, background_mode, default_guest_locales,
       look_version, version, hero_asset_id, hero_focal_x, hero_focal_y, updated_by,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'Harbour House', '#101010', '#FFFFFF', '#202020', 'HARBOUR',
               'manual', '["bg","en"]'::jsonb, 3, 1, $5, 0.25, 0.75, $4, now(), now())`,
    [
      randomUUID(),
      organizationId,
      fixture.propertyId,
      fixture.userId,
      fixture.mediaAssetId,
    ],
  )
  await q(
    `INSERT INTO property_portal_brand_contents (
       id, organization_id, property_id, locale, title, short_description, hero_alt_text,
       version, updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Harbour House', 'By the water', 'Boats in the harbour', 1,
               $4, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.userId],
  )
  await q(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{"links": []}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', now(), 0, 1, $6, now())`,
    [
      fixture.snapshotId,
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      DIGEST,
      fixture.userId,
    ],
  )
  await q(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id, activation_sequence,
       kind, activated_by, activated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'publish', $6, now())`,
    [
      fixture.activationId,
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      fixture.snapshotId,
      fixture.userId,
    ],
  )
  await q(
    `INSERT INTO portal_pending_content_changes (
       id, organization_id, property_id, portal_id, change_kind, change_key,
       source_version, changed_at
     ) VALUES ($1, $2, $3, $4, 'portal_links', 'all', 'portal-links-v2', now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalId],
  )
  await q(
    `INSERT INTO portal_responsible_managers (
       id, organization_id, property_id, portal_id, user_id, effective_from, created_by
     ) VALUES ($1, $2, $3, $4, $5, now(), $5)`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalId, fixture.userId],
  )
  await q(
    `INSERT INTO portal_health_intervals (
       id, organization_id, property_id, portal_id, status, reason, source_version,
       effective_from, observed_at
     ) VALUES ($1, $2, $3, $4, 'healthy', 'published_and_reachable', 'health-v1',
               now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalId],
  )

  // Secret and dark-capability rows the export must never touch.
  await q(
    `INSERT INTO portal_tokens (
       id, organization_id, property_id, portal_id, token_identifier, token_hash,
       encrypted_raw_token, address_encryption_key_version, version, status,
       issued_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'NEVER_EXPORT_RAW_TOKEN', 1, 1, 'active',
               now(), now())`,
    [
      fixture.tokenId,
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      fixture.tokenIdentifier,
      fixture.tokenHash,
    ],
  )
  await q(
    `INSERT INTO portal_access_artifacts (
       id, organization_id, property_id, portal_id, portal_token_id, channel, status,
       published_at
     ) VALUES ($1, $2, $3, $4, $5, 'qr', 'published', now())`,
    [
      fixture.artifactId,
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      fixture.tokenId,
    ],
  )
  await q(
    `INSERT INTO portal_address_downloads (
       id, organization_id, property_id, portal_id, portal_token_id, downloaded_by,
       purpose, downloaded_at
     ) VALUES ($1, $2, $3, $4, $5, 'user-exporter', 'download', now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalId, fixture.tokenId],
  )
  return fixture
}

describe.sequential('Portal Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      for (const table of CHILD_TABLES) {
        // Table names come from the frozen constant above, never from input.
        await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
          organizationId,
        ])
      }
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('exports every tenant-visible Portal collection without tokens', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createPortalOrganizationExportContributor(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'portal',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path, mediaType }) => ({ path, mediaType }))).toEqual([
      { path: 'portal/portals.csv', mediaType: 'text/csv' },
      { path: 'portal/portals.json', mediaType: 'application/json' },
    ])

    const json = first.entries.find(({ mediaType }) => mediaType === 'application/json')!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as Readonly<
      Record<string, readonly Readonly<Record<string, unknown>>[]>
    >
    for (const collection of [
      'portals',
      'portalGroups',
      'portalGroupMembers',
      'portalGroupHistory',
      'linkCategories',
      'links',
      'linkTexts',
      'mediaAssets',
      'approvedDestinations',
      'localizedOverrides',
      'brandProfiles',
      'brandContents',
      'publicationSnapshots',
      'publicationActivations',
      'pendingContentChanges',
      'responsibleManagers',
      'accessArtifacts',
      'addressDownloads',
      'healthIntervals',
    ]) {
      expect(payload[collection], collection).toHaveLength(1)
    }
    expect(payload.portals?.[0]).toMatchObject({
      id: fixture.portalId,
      name: 'Front Desk',
      slug: 'front-desk',
      publication_state: 'published',
      linktree_enabled: true,
    })
    expect(payload.portalGroups?.[0]).toMatchObject({ created_by: fixture.userId })
    // Names live in the ledger, not on events, so the export carries them.
    expect(payload.portalGroupHistory?.[0]).toMatchObject({
      portal_group_id: fixture.groupId,
      kind: 'renamed',
      name: 'Ground Floor',
      previous_name: 'Lobby Level',
      actor_user_id: fixture.userId,
    })
    expect(payload.linkTexts?.[0]).toMatchObject({
      link_id: fixture.linkId,
      locale: 'en',
      label: 'Review us',
      line: 'Two minutes',
      provenance: null,
    })
    expect(payload.localizedOverrides?.[0]).toMatchObject({
      locale: 'bg',
      title: 'Рецепция',
      linktree_title: 'Полезни връзки',
    })
    // The Property look is the customer's own data: every column is exported.
    expect(payload.brandProfiles?.[0]).toMatchObject({
      display_name: 'Harbour House',
      wordmark: 'HARBOUR',
      background_mode: 'manual',
      default_guest_locales: '["bg", "en"]',
      look_version: 3,
      hero_asset_id: fixture.mediaAssetId,
      hero_focal_x: 0.25,
      hero_focal_y: 0.75,
      logo_asset_id: null,
    })
    // The row, not the image: the stored object is not part of a data export.
    expect(payload.mediaAssets?.[0]).toMatchObject({
      id: fixture.mediaAssetId,
      purpose: 'hero',
      status: 'active',
      object_key: `portal-media/${fixture.mediaAssetId}.webp`,
      width: 2400,
      height: 1600,
      source_format: 'jpeg',
      taken_down_at: null,
      object_deleted_at: null,
    })
    expect(payload.brandContents?.[0]).toMatchObject({
      locale: 'en',
      hero_alt_text: 'Boats in the harbour',
    })
    expect(payload.publicationSnapshots?.[0]).toMatchObject({
      id: fixture.snapshotId,
      configuration_digest: DIGEST,
      contact_request_enabled: false,
    })
    // Metadata only: the artifact is exported, its token join key is not.
    expect(payload.accessArtifacts?.[0]).toMatchObject({
      id: fixture.artifactId,
      channel: 'qr',
      status: 'published',
    })
    expect(payload.accessArtifacts?.[0]).not.toHaveProperty('portal_token_id')
    expect(payload.addressDownloads?.[0]).toMatchObject({
      portal_id: fixture.portalId,
      downloaded_by: 'user-exporter',
      purpose: 'download',
    })
    expect(payload.addressDownloads?.[0]).not.toHaveProperty('portal_token_id')

    const archiveText = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archiveText).not.toContain('NEVER_EXPORT_RAW_TOKEN')
    expect(archiveText).not.toContain(fixture.tokenHash)
    expect(archiveText).not.toContain(fixture.tokenIdentifier)
    expect(archiveText).not.toContain(fixture.tokenId)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'portal'
          ? contributor
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })
    const contextEntries = bundle.entries.filter(({ path }) => path.startsWith('portal/'))
    expect(contextEntries.map(({ path }) => path)).toEqual([
      'portal/portals.csv',
      'portal/portals.json',
    ])
    expect(new Set(contextEntries.map(({ classification }) => classification))).toEqual(
      new Set(['tenant_visible']),
    )
  })

  it('answers no_data for an Organization that owns no Portal row', async () => {
    const organizationId = await seedOrganization()

    const contribution = await createPortalOrganizationExportContributor(db).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'portal',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })
})
