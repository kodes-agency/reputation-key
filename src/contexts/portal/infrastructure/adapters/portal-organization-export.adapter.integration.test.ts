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
  'portal_access_artifacts',
  'portal_tokens',
  'portal_upload_issuances',
  'portal_pending_content_changes',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_health_intervals',
  'portal_responsible_managers',
  'portal_localized_overrides',
  'portal_links',
  'portal_link_categories',
  'portal_group_members',
  'portal_groups',
  'portal_approved_destinations',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
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
  destinationId: string
  snapshotId: string
  activationId: string
  artifactId: string
  tokenId: string
  uploadIssuanceId: string
  tokenIdentifier: string
  tokenHash: string
  uploadObjectKey: string
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
  const uploadIssuanceId = randomUUID()
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    groupId: randomUUID(),
    categoryId: randomUUID(),
    linkId: randomUUID(),
    destinationId: randomUUID(),
    snapshotId: randomUUID(),
    activationId: randomUUID(),
    artifactId: randomUUID(),
    tokenId,
    uploadIssuanceId,
    tokenIdentifier: randomUUID().replaceAll('-', '').slice(0, 24),
    tokenHash: 'f'.repeat(64),
    uploadObjectKey: `private/portal-uploads/${uploadIssuanceId}/source.jpg`,
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
                                created_at, updated_at)
     VALUES ($1, $2, $3, 'Ground Floor', 'a', now(), now())`,
    [fixture.groupId, organizationId, fixture.propertyId],
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
    `INSERT INTO portal_localized_overrides (
       id, organization_id, property_id, portal_id, locale, title, version,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'bg', 'Рецепция', 1, $5, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalId, fixture.userId],
  )
  await q(
    `INSERT INTO property_portal_brand_profiles (
       id, organization_id, property_id, display_name, primary_color,
       background_color, text_color, version, updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Harbour House', '#101010', '#FFFFFF', '#202020', 1, $4,
               now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.userId],
  )
  await q(
    `INSERT INTO property_portal_brand_contents (
       id, organization_id, property_id, locale, title, short_description, version,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Harbour House', 'By the water', 1, $4, now(), now())`,
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
    `INSERT INTO portal_upload_issuances (
       id, organization_id, property_id, portal_id, object_key, content_type,
       declared_size_bytes, max_size_bytes, state, issued_at, expires_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'image/jpeg', 1024, 10485760, 'issued',
               now(), now() + interval '1 hour', now(), now())`,
    [
      fixture.uploadIssuanceId,
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      fixture.uploadObjectKey,
    ],
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

  it('exports every tenant-visible Portal collection without tokens or upload issuances', async () => {
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
      'linkCategories',
      'links',
      'approvedDestinations',
      'localizedOverrides',
      'brandProfiles',
      'brandContents',
      'publicationSnapshots',
      'publicationActivations',
      'pendingContentChanges',
      'responsibleManagers',
      'accessArtifacts',
      'healthIntervals',
    ]) {
      expect(payload[collection], collection).toHaveLength(1)
    }
    expect(payload.portals?.[0]).toMatchObject({
      id: fixture.portalId,
      name: 'Front Desk',
      slug: 'front-desk',
      publication_state: 'published',
    })
    expect(payload.localizedOverrides?.[0]).toMatchObject({
      locale: 'bg',
      title: 'Рецепция',
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

    const archiveText = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archiveText).not.toContain('NEVER_EXPORT_RAW_TOKEN')
    expect(archiveText).not.toContain(fixture.tokenHash)
    expect(archiveText).not.toContain(fixture.tokenIdentifier)
    expect(archiveText).not.toContain(fixture.tokenId)
    expect(archiveText).not.toContain(fixture.uploadIssuanceId)
    expect(archiveText).not.toContain(fixture.uploadObjectKey)

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
    // Portal upload stays dark: no entry path may exist for an issuance.
    expect(bundle.entries.some(({ path }) => /upload|issuance/u.test(path))).toBe(false)
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
