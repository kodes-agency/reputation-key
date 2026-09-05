import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createStaffOrganizationExportContributor } from './staff-organization-export.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `staff-export-org-${suffix}`
const OTHER_ORGANIZATION_ID = `staff-export-other-${suffix}`
const EMPTY_ORGANIZATION_ID = `staff-export-empty-${suffix}`
const PROPERTY_ID = randomUUID()
const OTHER_PROPERTY_ID = randomUUID()
const PORTAL_ID = randomUUID()
const PORTAL_GROUP_ID = randomUUID()
const PARTICIPANT_ID = randomUUID()
const OTHER_PARTICIPANT_ID = randomUUID()
const PARTICIPATION_ID = randomUUID()
const OTHER_PARTICIPATION_ID = randomUUID()
const USER_LINK_ID = randomUUID()
const RESPONSIBILITY_ID = randomUUID()
const GROUP_MEMBERSHIP_ID = randomUUID()
const ACCESS_GRANT_ID = randomUUID()

const ORGANIZATION_IDS = [
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  EMPTY_ORGANIZATION_ID,
] as const

const EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z'

async function seedOrganization(organizationId: string): Promise<void> {
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Staff Export Fixture', $1, NOW())`,
    [organizationId],
  )
}

async function seedProperty(organizationId: string, propertyId: string): Promise<void> {
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Staff Export Property', $3, 'UTC')`,
    [propertyId, organizationId, `property-${propertyId}`],
  )
}

async function seedPeople(
  organizationId: string,
  propertyId: string,
  participantId: string,
  participationId: string,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, created_by)
     VALUES ($1, $2, 'Dana, "D" Rivera', 'active', 'user-admin')`,
    [participantId, organizationId],
  )
  await lease.pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, display_name,
        status, created_by)
     VALUES ($1, $2, $3, $4, 'Dana Rivera', 'active', 'user-admin')`,
    [participationId, organizationId, propertyId, participantId],
  )
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database

  for (const organizationId of ORGANIZATION_IDS) await seedOrganization(organizationId)
  await seedProperty(ORGANIZATION_ID, PROPERTY_ID)
  await seedProperty(OTHER_ORGANIZATION_ID, OTHER_PROPERTY_ID)
  await seedPeople(ORGANIZATION_ID, PROPERTY_ID, PARTICIPANT_ID, PARTICIPATION_ID)

  await lease.pool.query(
    `INSERT INTO staff_user_links
       (id, organization_id, staff_participant_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $3, 'user-dana', $4, 'user-admin')`,
    [USER_LINK_ID, ORGANIZATION_ID, PARTICIPANT_ID, EFFECTIVE_FROM],
  )
  await lease.pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Staff Export Portal', $4)`,
    [PORTAL_ID, ORGANIZATION_ID, PROPERTY_ID, `portal-${PORTAL_ID}`],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk', NOW(), NOW())`,
    [PORTAL_GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
  await lease.pool.query(
    `INSERT INTO portal_responsibilities
       (id, organization_id, property_id, portal_id, staff_participation_id,
        kind, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'primary', $6, 'user-admin')`,
    [
      RESPONSIBILITY_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      PORTAL_ID,
      PARTICIPATION_ID,
      EFFECTIVE_FROM,
    ],
  )
  await lease.pool.query(
    `INSERT INTO portal_group_memberships
       (id, organization_id, property_id, portal_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'user-admin')`,
    [
      GROUP_MEMBERSHIP_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      PORTAL_ID,
      PORTAL_GROUP_ID,
      EFFECTIVE_FROM,
    ],
  )
  // Identity owns property access. Seeding a real grant proves the Staff
  // contributor does not duplicate it — the assertion below would otherwise
  // pass vacuously.
  await lease.pool.query(
    `INSERT INTO property_access_grants
       (id, organization_id, property_id, user_id, kind, status, granted_by)
     VALUES ($1, $2, $3, 'user-dana', 'manage', 'active', 'user-admin')`,
    [ACCESS_GRANT_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
  // A second tenant's people rows must never appear in this Organization's ZIP.
  await seedPeople(
    OTHER_ORGANIZATION_ID,
    OTHER_PROPERTY_ID,
    OTHER_PARTICIPANT_ID,
    OTHER_PARTICIPATION_ID,
  )
})

afterAll(async () => {
  const organizationIds = [...ORGANIZATION_IDS]
  for (const table of [
    'property_access_grants',
    'portal_group_memberships',
    'portal_responsibilities',
    'portal_groups',
    'portals',
    'staff_user_links',
    'staff_participations',
    'staff_participants',
    'properties',
  ]) {
    await lease.pool.query(
      `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
  }
  await deleteTestOrganizations(lease.pool, organizationIds)
  await lease.release()
})

describe.sequential('Staff Organization Export contributor (real PostgreSQL)', () => {
  it('exports tenant-scoped people rows deterministically', async () => {
    const contributor = createStaffOrganizationExportContributor(db)
    const asOf = new Date(Date.now() - 1000)

    const first = await contributor.contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first.coverage).toBe('complete')
    expect(first.omissionCodes).toEqual([])
    expect(first.entries.map(({ path }) => path)).toEqual([
      'staff/participants.csv',
      'staff/participants.json',
      'staff/participations.csv',
      'staff/participations.json',
      'staff/portal-responsibilities.csv',
      'staff/portal-responsibilities.json',
      'staff/portal-group-memberships.csv',
      'staff/portal-group-memberships.json',
    ])

    const participants = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'staff/participants.json')!.bytes,
      ).toString('utf8'),
    ) as {
      participants: readonly Record<string, unknown>[]
      participantUserLinks: readonly Record<string, unknown>[]
    }
    expect(participants.participants).toEqual([
      expect.objectContaining({
        id: PARTICIPANT_ID,
        display_name: 'Dana, "D" Rivera',
        status: 'active',
        revision: 1,
      }),
    ])
    expect(participants.participantUserLinks).toEqual([
      expect.objectContaining({ id: USER_LINK_ID, user_id: 'user-dana' }),
    ])

    const participations = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'staff/participations.json')!.bytes,
      ).toString('utf8'),
    ) as {
      participations: readonly Record<string, unknown>[]
    }
    expect(participations.participations).toEqual([
      expect.objectContaining({ id: PARTICIPATION_ID, property_id: PROPERTY_ID }),
    ])

    const responsibilities = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'staff/portal-responsibilities.json')!
          .bytes,
      ).toString('utf8'),
    ) as { portalResponsibilities: readonly Record<string, unknown>[] }
    expect(responsibilities.portalResponsibilities).toEqual([
      expect.objectContaining({ id: RESPONSIBILITY_ID, portal_id: PORTAL_ID }),
    ])

    const memberships = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'staff/portal-group-memberships.json')!
          .bytes,
      ).toString('utf8'),
    ) as { portalGroupMemberships: readonly Record<string, unknown>[] }
    expect(memberships.portalGroupMemberships).toEqual([
      expect.objectContaining({
        id: GROUP_MEMBERSHIP_ID,
        portal_group_id: PORTAL_GROUP_ID,
      }),
    ])
  })

  it('does not duplicate the identity-owned property access grant rows', async () => {
    const contributor = createStaffOrganizationExportContributor(db)
    const contribution = await contributor.contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const archive = contribution.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')

    expect(archive).not.toContain(ACCESS_GRANT_ID)
    expect(archive).not.toContain('property_access_grants')
    expect(archive).not.toContain('property_access_grant"')
    expect(archive).not.toContain('granted_by')
  })

  it('never leaks another Organization rows', async () => {
    const contributor = createStaffOrganizationExportContributor(db)
    const contribution = await contributor.contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const archive = contribution.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')

    expect(archive).not.toContain(OTHER_PARTICIPANT_ID)
    expect(archive).not.toContain(OTHER_PROPERTY_ID)
    expect(archive).not.toContain(OTHER_ORGANIZATION_ID)
  })

  it('answers no_data for an Organization with no people rows', async () => {
    const contributor = createStaffOrganizationExportContributor(db)

    expect(
      await contributor.contribute({
        organizationId: EMPTY_ORGANIZATION_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      }),
    ).toEqual({
      context: 'staff',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const contributor = createStaffOrganizationExportContributor(db)
    const bundle = await buildOrganizationExportBundle({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'staff'
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

    expect(bundle.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'staff/participants.csv',
        'staff/participants.json',
        'staff/portal-group-memberships.json',
        'manifest.json',
      ]),
    )
  })
})
