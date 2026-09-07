import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '../application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '../domain/organization-lifecycle'
import { createIdentityOrganizationExportContributor } from './identity-organization-export-contributor'

const organizations = new Set<string>()
const users = new Set<string>()
let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  roleId: string
  invitationId: string
  accountId: string
  sessionId: string
  preciseCreatedAt: string
}>

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID()
  const createdAt = new Date(Date.now() - 60_000)
  const preciseCreatedAt = createdAt.toISOString().replace(/\.\d{3}Z$/u, '.123456Z')
  const fixture = {
    organizationId: `identity-export-org-${suffix}`,
    userId: `identity-export-user-${suffix}`,
    memberId: `identity-export-member-${suffix}`,
    roleId: `identity-export-role-${suffix}`,
    invitationId: `identity-export-invitation-${suffix}`,
    accountId: `identity-export-account-${suffix}`,
    sessionId: `identity-export-session-${suffix}`,
    preciseCreatedAt,
  }
  organizations.add(fixture.organizationId)
  users.add(fixture.userId)
  await lease.pool.query(
    `INSERT INTO organization (
       id, name, slug, logo, "createdAt", "contactEmail"
     ) VALUES ($1, 'Identity Export Fixture', $1, 'https://cdn.example.test/logo',
               $2, 'manager@example.test')`,
    [fixture.organizationId, preciseCreatedAt],
  )
  await lease.pool.query(
    `INSERT INTO "user" (
       id, name, email, "emailVerified", image, "createdAt", "updatedAt"
     ) VALUES ($1, 'Export Manager', $2, true,
               'https://cdn.example.test/avatar', $3, $3)`,
    [fixture.userId, `${suffix}@example.test`, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [fixture.memberId, fixture.userId, fixture.organizationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO invitation (
       id, "organizationId", email, role, status, "expiresAt", "propertyIds",
       "inviterId", "createdAt"
     ) VALUES ($1, $2, 'invitee@example.test', 'member', 'pending',
               $3, '[]', $4, $5)`,
    [
      fixture.invitationId,
      fixture.organizationId,
      new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      fixture.userId,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO "organizationRole" (
       id, "organizationId", role, permission, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'auditor', '{"property":["read"]}', $3, $3)`,
    [fixture.roleId, fixture.organizationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO organization_role_policy (
       organization_id, role, data_scope, created_at, updated_at
     ) VALUES ($1, 'auditor', 'assigned-properties', $2, $2)`,
    [fixture.organizationId, createdAt],
  )

  // These rows carry material that Organization Export must never query.
  await lease.pool.query(
    `INSERT INTO account (
       id, "accountId", "providerId", "userId", "accessToken", "refreshToken",
       "idToken", password, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'credential', $3, 'NEVER_EXPORT_ACCESS',
               'NEVER_EXPORT_REFRESH', 'NEVER_EXPORT_ID', 'NEVER_EXPORT_PASSWORD',
               $4, $4)`,
    [fixture.accountId, fixture.accountId, fixture.userId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO session (
       id, "expiresAt", token, "userId", "activeOrganizationId",
       "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'NEVER_EXPORT_SESSION', $3, $4, $5, $5)`,
    [
      fixture.sessionId,
      new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
      fixture.userId,
      fixture.organizationId,
      createdAt,
    ],
  )
  return fixture
}

describe.sequential('Identity Organization Export contributor', () => {
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
        `DELETE FROM session
         WHERE "activeOrganizationId" = $1
            OR "userId" IN (
              SELECT "userId" FROM member WHERE "organizationId" = $1
            )`,
        [organizationId],
      )
      await lease.pool.query(
        `DELETE FROM account
         WHERE "userId" IN (
           SELECT "userId" FROM member WHERE "organizationId" = $1
         )`,
        [organizationId],
      )
      await lease.pool.query('DELETE FROM invitation WHERE "organizationId" = $1', [
        organizationId,
      ])
      await lease.pool.query(
        'DELETE FROM organization_role_policy WHERE organization_id = $1',
        [organizationId],
      )
      await lease.pool.query(
        'DELETE FROM "organizationRole" WHERE "organizationId" = $1',
        [organizationId],
      )
      await executeWithLastOwnerGuardDisabled(db, [
        sql`DELETE FROM member WHERE "organizationId" = ${organizationId}`,
      ])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    for (const userId of users) {
      await lease.pool.query('DELETE FROM "user" WHERE id = $1', [userId])
    }
    organizations.clear()
    users.clear()
  })

  it('exports deterministic tenant-visible Identity data without auth secrets', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createIdentityOrganizationExportContributor(db)

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
      context: 'identity',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path, mediaType }) => ({ path, mediaType }))).toEqual([
      { path: 'identity/organization.csv', mediaType: 'text/csv' },
      { path: 'identity/organization.json', mediaType: 'application/json' },
    ])

    const json = first.entries.find(({ mediaType }) => mediaType === 'application/json')!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as Record<
      string,
      unknown
    >
    expect(payload).toMatchObject({
      version: 'identity-organization-export/v1',
      organization: {
        id: fixture.organizationId,
        name: 'Identity Export Fixture',
        contact_email: 'manager@example.test',
        created_at: fixture.preciseCreatedAt,
      },
      members: [
        {
          id: fixture.memberId,
          user_id: fixture.userId,
          name: 'Export Manager',
          role: 'owner',
        },
      ],
      invitations: [
        { id: fixture.invitationId, email: 'invitee@example.test', status: 'pending' },
      ],
      customRoles: [{ id: fixture.roleId, role: 'auditor' }],
      rolePolicies: [{ role: 'auditor', data_scope: 'assigned-properties' }],
    })
    const archiveText = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archiveText).not.toContain('NEVER_EXPORT_')
    expect(archiveText).not.toContain(fixture.accountId)
    expect(archiveText).not.toContain(fixture.sessionId)
    expect(archiveText).not.toMatch(/accessToken|refreshToken|idToken|password/u)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'identity'
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
        'identity/organization.csv',
        'identity/organization.json',
        'coverage.json',
        'manifest.json',
      ]),
    )
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()
    const contributor = createIdentityOrganizationExportContributor(db)

    await expect(
      contributor.contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
