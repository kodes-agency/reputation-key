import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createPropertyOrganizationExportContributor } from './property-organization-export.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  archivedPropertyId: string
  managerAssignmentId: string
  userId: string
  receiptId: string
  gbpLocationId: string
  preciseCreatedAt: string
}>

async function seedOrganization(): Promise<string> {
  const organizationId = `property-export-org-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Property Export Fixture', $1, now())`,
    [organizationId],
  )
  return organizationId
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = await seedOrganization()
  const createdAt = new Date(Date.now() - 60_000)
  const preciseCreatedAt = createdAt.toISOString().replace(/\.\d{3}Z$/u, '.123456Z')
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    archivedPropertyId: randomUUID(),
    managerAssignmentId: randomUUID(),
    userId: `property-export-user-${randomUUID()}`,
    receiptId: randomUUID(),
    gbpLocationId: `NEVER-EXPORT-LOCATION-${randomUUID()}`,
    preciseCreatedAt,
  }

  await lease.pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, address, country_code,
       lifecycle_state, created_at, updated_at
     ) VALUES (
       $1, $2, 'Harbour House', 'harbour-house', 'Europe/Sofia',
       '12 Dock Road', 'US', 'active', $3, $3
     )`,
    [fixture.propertyId, organizationId, preciseCreatedAt],
  )
  // A Google-bound Property proves the provider identifiers stay out of the
  // archive while the content-free binding state stays in it.
  await lease.pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, lifecycle_state,
       gbp_location_id, google_binding_state, created_at, updated_at, deleted_at
     ) VALUES (
       $1, $2, 'Retired Annex', 'retired-annex', 'UTC', 'archived',
       $3, 'account_confirmation_required', $4, $4, $4
     )`,
    [fixture.archivedPropertyId, organizationId, fixture.gbpLocationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO property_responsible_managers (
       id, organization_id, property_id, user_id, effective_from, created_by
     ) VALUES ($1, $2, $3, $4, $5, $4)`,
    [
      fixture.managerAssignmentId,
      organizationId,
      fixture.propertyId,
      fixture.userId,
      createdAt,
    ],
  )

  // This content-free receipt does not belong in a tenant archive.
  await lease.pool.query(
    `INSERT INTO property_operation_receipts (
       id, organization_id, idempotency_key, destination_property_id, outcome,
       destination_source_epoch, destination_profile_version, tombstone,
       expires_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'imported', 0, 1, false, now() + interval '1 day',
               now(), now())`,
    [fixture.receiptId, organizationId, randomUUID(), fixture.propertyId],
  )
  return fixture
}

describe.sequential('Property Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query(
        'DELETE FROM property_operation_receipts WHERE organization_id = $1',
        [organizationId],
      )
      await lease.pool.query(
        'DELETE FROM property_responsible_managers WHERE organization_id = $1',
        [organizationId],
      )
      await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('exports Property rows and responsibility without receipts or provider identifiers', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createPropertyOrganizationExportContributor(db)

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
      context: 'property',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path, mediaType }) => ({ path, mediaType }))).toEqual([
      { path: 'property/properties.csv', mediaType: 'text/csv' },
      { path: 'property/properties.json', mediaType: 'application/json' },
    ])

    const json = first.entries.find(({ mediaType }) => mediaType === 'application/json')!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as Readonly<{
      properties: readonly Readonly<Record<string, unknown>>[]
      responsibleManagers: readonly Readonly<Record<string, unknown>>[]
    }>
    expect(payload.properties).toHaveLength(2)
    expect(payload.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.propertyId,
          name: 'Harbour House',
          slug: 'harbour-house',
          timezone: 'Europe/Sofia',
          address: '12 Dock Road',
          country_code: 'US',
          lifecycle_state: 'active',
          created_at: fixture.preciseCreatedAt,
        }),
        expect.objectContaining({
          id: fixture.archivedPropertyId,
          lifecycle_state: 'archived',
          google_binding_state: 'account_confirmation_required',
        }),
      ]),
    )
    expect(payload.responsibleManagers).toEqual([
      expect.objectContaining({
        id: fixture.managerAssignmentId,
        property_id: fixture.propertyId,
        user_id: fixture.userId,
      }),
    ])

    const archiveText = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archiveText).not.toContain(fixture.gbpLocationId)
    expect(archiveText).not.toContain(fixture.receiptId)
    expect(archiveText).not.toMatch(/gbp_account_id|gbp_location_id|google_review_uri/u)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'property'
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
    const contextEntries = bundle.entries.filter(({ path }) =>
      path.startsWith('property/'),
    )
    expect(contextEntries.map(({ path }) => path)).toEqual([
      'property/properties.csv',
      'property/properties.json',
    ])
    expect(new Set(contextEntries.map(({ classification }) => classification))).toEqual(
      new Set(['tenant_visible']),
    )
  })

  it('answers no_data for an Organization that owns no Property row', async () => {
    const organizationId = await seedOrganization()

    const contribution = await createPropertyOrganizationExportContributor(db).contribute(
      {
        organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      },
    )

    expect(contribution).toEqual({
      context: 'property',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })
})
