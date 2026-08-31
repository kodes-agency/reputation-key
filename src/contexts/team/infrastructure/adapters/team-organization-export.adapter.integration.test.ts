import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { buildTeamContext } from '../../build'
import { createTeamOrganizationExportContributor } from './team-organization-export.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `team-export-org-${suffix}`
const EMPTY_ORGANIZATION_ID = `team-export-empty-${suffix}`
const PROPERTY_ID = randomUUID()
const PORTAL_GROUP_ID = randomUUID()
const PARTICIPANT_ID = randomUUID()
const PARTICIPATION_ID = randomUUID()
const TEAM_ID = randomUUID()
const MEMBERSHIP_ID = randomUUID()
const SCOPE_ID = randomUUID()

const ORGANIZATION_IDS = [ORGANIZATION_ID, EMPTY_ORGANIZATION_ID] as const
const EFFECTIVE_FROM = '2025-06-02T00:00:00.000Z'
const DELETED_AT = '2025-09-01T00:00:00.000Z'

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database

  for (const organizationId of ORGANIZATION_IDS) {
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Team Export Fixture', $1, NOW())`,
      [organizationId],
    )
  }
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Team Export Property', $3, 'UTC')`,
    [PROPERTY_ID, ORGANIZATION_ID, `property-${PROPERTY_ID}`],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk Group', NOW(), NOW())`,
    [PORTAL_GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
  await lease.pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, created_by)
     VALUES ($1, $2, 'Dana Rivera', 'active', 'user-admin')`,
    [PARTICIPANT_ID, ORGANIZATION_ID],
  )
  await lease.pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, display_name,
        status, created_by)
     VALUES ($1, $2, $3, $4, 'Dana Rivera', 'active', 'user-admin')`,
    [PARTICIPATION_ID, ORGANIZATION_ID, PROPERTY_ID, PARTICIPANT_ID],
  )
  // A retired Team: `deleted_at` is set, and the memberships that point at it
  // still exist. The export must show both.
  await lease.pool.query(
    `INSERT INTO teams
       (id, organization_id, property_id, name, description, deleted_at)
     VALUES ($1, $2, $3, 'Front Desk', 'Retired in favour of Portal Groups', $4)`,
    [TEAM_ID, ORGANIZATION_ID, PROPERTY_ID, DELETED_AT],
  )
  await lease.pool.query(
    `INSERT INTO team_memberships
       (id, organization_id, property_id, team_id, staff_participation_id,
        role, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'lead', $6, 'user-admin')`,
    [
      MEMBERSHIP_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      TEAM_ID,
      PARTICIPATION_ID,
      EFFECTIVE_FROM,
    ],
  )
  await lease.pool.query(
    `INSERT INTO team_portal_group_scopes
       (id, organization_id, property_id, team_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'user-admin')`,
    [SCOPE_ID, ORGANIZATION_ID, PROPERTY_ID, TEAM_ID, PORTAL_GROUP_ID, EFFECTIVE_FROM],
  )
})

afterAll(async () => {
  const organizationIds = [...ORGANIZATION_IDS]
  for (const table of [
    'team_portal_group_scopes',
    'team_memberships',
    'teams',
    'staff_participations',
    'staff_participants',
    'portal_groups',
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

describe.sequential('Team Organization Export contributor (real PostgreSQL)', () => {
  it('exports retained Team rows deterministically as a complete contribution', async () => {
    const contributor = createTeamOrganizationExportContributor(db)
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
      'team/teams.csv',
      'team/teams.json',
      'team/memberships.csv',
      'team/memberships.json',
      'team/portal-group-scopes.csv',
      'team/portal-group-scopes.json',
    ])

    const teams = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'team/teams.json')!.bytes,
      ).toString('utf8'),
    ) as { teams: readonly Record<string, unknown>[] }
    expect(teams.teams).toEqual([
      expect.objectContaining({
        id: TEAM_ID,
        name: 'Front Desk',
        deleted_at: '2025-09-01T00:00:00.000000Z',
      }),
    ])

    const memberships = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'team/memberships.json')!.bytes,
      ).toString('utf8'),
    ) as { memberships: readonly Record<string, unknown>[] }
    expect(memberships.memberships).toEqual([
      expect.objectContaining({
        id: MEMBERSHIP_ID,
        role: 'lead',
        effective_to: null,
      }),
    ])

    const scopes = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'team/portal-group-scopes.json')!.bytes,
      ).toString('utf8'),
    ) as { portalGroupScopes: readonly Record<string, unknown>[] }
    expect(scopes.portalGroupScopes).toEqual([
      expect.objectContaining({ id: SCOPE_ID, portal_group_id: PORTAL_GROUP_ID }),
    ])
  })

  it('answers no_data for an Organization that never used Teams', async () => {
    const contributor = createTeamOrganizationExportContributor(db)

    expect(
      await contributor.contribute({
        organizationId: EMPTY_ORGANIZATION_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      }),
    ).toEqual({
      context: 'team',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const contributor = createTeamOrganizationExportContributor(db)
    const bundle = await buildOrganizationExportBundle({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'team'
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
        'team/teams.csv',
        'team/memberships.json',
        'manifest.json',
      ]),
    )
  })

  it('contributing does not enable any Team capability', async () => {
    await createTeamOrganizationExportContributor(db).contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const context = buildTeamContext()

    expect(Object.keys(context.publicApi)).toEqual([])
    expect(Object.keys(context.internal.repos)).toEqual([])
    expect(Object.keys(context.internal.useCases)).toEqual([])
  })
})
