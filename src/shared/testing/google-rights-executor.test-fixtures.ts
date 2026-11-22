// Seeds and drivers for the Google rights executor suites: two tenants are
// seeded so every case can prove the other one is untouched.

import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  organizationApplyArgv,
  runRightsRequestScript,
} from '#/shared/db/testing/rights-request-script'
import {
  countRows,
  snapshotTenantTables,
} from '#/shared/db/testing/rights-tenant-snapshot'
import { seedGoogleConnection } from './google-connection-seed'
import {
  insertGoogleImport,
  insertGoogleItem,
  insertPendingGoogleItem,
} from './google-import-rights-seed'
import { deleteTestOrganizations } from './integration-helpers'
import { acquireTestLease, type TestLease } from './test-environment-lease'
import { createGoogleRightsExecutor } from '#/shared/ops/rights/google-rights-executor'
import type { RightsJournalStore } from '#/shared/ops/rights/rights-journal'

export const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')
export const NOW = new Date('2026-11-08T12:00:00.000Z')

export const MARKERS = Object.freeze({
  accessToken: 'RIGHTS_ACCESS_TOKEN',
  refreshToken: 'RIGHTS_REFRESH_TOKEN',
  googleSubject: 'RIGHTS_GOOGLE_SUBJECT',
  providerSuffix: 'rights-provider-suffix',
  replayDigest: `RightsReplayDigest${'0'.repeat(25)}`,
})

export type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  propertyId: string
  siblingPropertyId: string
  importId: string
  connectionId: string
  permitId: string
}>

export const RECEIPT_SCOPES = [
  'google_oauth_exchange',
  'gbp_import_item_retry',
  'google_import_discovery',
  'google_disconnect_revoke',
]

const fixtures: Fixture[] = []
let lease: TestLease
let db: Database

export const harness = {
  get lease(): TestLease {
    return lease
  },
  get db(): Database {
    return db
  },
}

export async function seed(options: { live: boolean }): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `rights-org-${suffix}`,
    userId: `rights-user-${suffix}`,
    memberId: `rights-member-${suffix}`,
    propertyId: randomUUID(),
    siblingPropertyId: randomUUID(),
    importId: randomUUID(),
    connectionId: randomUUID(),
    permitId: randomUUID(),
  }
  fixtures.push(fixture)
  const q = lease.pool.query.bind(lease.pool)

  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights fixture', $1, $2)`,
    [fixture.organizationId, CREATED_AT],
  )
  await q(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Rights Manager', $2, true, $3, $3)`,
    [fixture.userId, `${suffix}@example.test`, CREATED_AT],
  )
  await q(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [fixture.memberId, fixture.userId, fixture.organizationId, CREATED_AT],
  )
  await seedGoogleConnection(lease.pool, {
    id: fixture.connectionId,
    organizationId: fixture.organizationId,
    googleSubject: options.live ? `${MARKERS.googleSubject}-${suffix}` : null,
    accessToken: options.live ? MARKERS.accessToken : 'redacted',
    refreshToken: options.live ? MARKERS.refreshToken : 'redacted',
    tokenExpiresAt: new Date(CREATED_AT.getTime() + 3_600_000),
    scopes: options.live ? ['https://www.googleapis.com/auth/business.manage'] : [],
    connectedBy: fixture.userId,
    credentialAuthorizedBy: fixture.userId,
    credentialAuthorizedAt: CREATED_AT,
    status: options.live ? 'active' : 'disconnected',
    credentialUseState: options.live ? 'active' : 'none',
    lastSuccessfulSyncAt: CREATED_AT,
    statusReason: 'connected',
    statusChangedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Rights Property', $3, 'UTC', $4, $4)`,
    [fixture.propertyId, fixture.organizationId, `rights-${suffix}`, CREATED_AT],
  )
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Sibling Property', $3, 'UTC', $4, $4)`,
    [fixture.siblingPropertyId, fixture.organizationId, `sibling-${suffix}`, CREATED_AT],
  )
  await seedGoogleImport(fixture)
  await q(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('google_disconnect_revoke', $1, jsonb_build_object(
       'id', $1::text,
       'organizationId', $2::text,
       'connectionId', $3::text,
       'initiatorUserId', $4::text,
       'state', 'confirmed_revoked',
       'credentialBinding', NULL,
       'activatedAt', $5::timestamptz,
       'terminalAt', $5::timestamptz,
       'outcomeCode', 'google_revoke_confirmed',
       'updatedAt', $5::timestamptz
     ), $5)`,
    [
      randomUUID(),
      fixture.organizationId,
      fixture.connectionId,
      fixture.userId,
      CREATED_AT,
    ],
  )
  await q(
    `INSERT INTO google_import_discovery_records (
       reference_key, key_version, audience, organization_id, user_id, connection_id,
       connection_lifecycle_version, connection_access_version, credential_generation,
       authorization_vector, payload, issued_at, expires_at
     ) VALUES ($1, 'v1', 'account_selection', $2, $3, $4, 1, 1, 1, '{}'::jsonb,
               '{}'::jsonb, $5, $5::timestamptz + interval '1 hour')`,
    [
      randomBytes(32).toString('base64url'),
      fixture.organizationId,
      fixture.userId,
      fixture.connectionId,
      CREATED_AT,
    ],
  )
  for (const scope of RECEIPT_SCOPES.filter(
    (name) => name !== 'google_disconnect_revoke',
  )) {
    await q(
      `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
       VALUES ($1, $2, jsonb_build_object(
         'organizationId', $3::text, 'terminalAt', $4::timestamptz), $4)`,
      [scope, randomUUID(), fixture.organizationId, CREATED_AT],
    )
  }
  await q(
    `INSERT INTO authorization_execution_permits (
       id, capability, organization_id, connection_id, initiator_user_id,
       operation_key, route_key, route_catalog_version, quota_policy_id,
       authorization_vector, state, admitted_at, start_deadline_at,
       started_at, operation_deadline_at, completed_at, correlation_id, created_at
     ) VALUES ($1, 'property.import_gbp_v2', $2, $3, $4, 'operation', 'route',
               'v1', 'quota', '{}'::jsonb, 'completed', $5, $6, $6, $7, $7,
               'correlation', $5)`,
    [
      fixture.permitId,
      fixture.organizationId,
      fixture.connectionId,
      fixture.userId,
      CREATED_AT,
      new Date(CREATED_AT.getTime() + 60_000),
      new Date(CREATED_AT.getTime() + 120_000),
    ],
  )
  return fixture
}

export const importRow = (fixture: Fixture, importId: string, totalCount: number) =>
  insertGoogleImport(lease.pool, {
    importId,
    organizationId: fixture.organizationId,
    userId: fixture.userId,
    totalCount,
    replayDigest: MARKERS.replayDigest,
    at: CREATED_AT,
  })

export const itemRow = (fixture: Fixture, importId: string, propertyId: string) =>
  insertGoogleItem(lease.pool, {
    organizationId: fixture.organizationId,
    importId,
    propertyId,
    at: CREATED_AT,
  })

export const pendingItemRow = (fixture: Fixture, importId: string, propertyId: string) =>
  insertPendingGoogleItem(lease.pool, {
    organizationId: fixture.organizationId,
    importId,
    propertyId,
    connectionId: fixture.connectionId,
    providerSuffix: MARKERS.providerSuffix,
    at: CREATED_AT,
  })

/** One new-store import with a terminal item for each of the two Properties. */
async function seedGoogleImport(fixture: Fixture): Promise<void> {
  await importRow(fixture, fixture.importId, 2)
  for (const propertyId of [fixture.propertyId, fixture.siblingPropertyId]) {
    await itemRow(fixture, fixture.importId, propertyId)
  }
}

/** An import holding only the Property's item. */
export async function seedSoloImports(
  fixture: Fixture,
  propertyId: string,
): Promise<void> {
  const soloImportId = randomUUID()
  await importRow(fixture, soloImportId, 1)
  await itemRow(fixture, soloImportId, propertyId)
}

async function cleanup(fixture: Fixture): Promise<void> {
  const q = lease.pool.query.bind(lease.pool)
  await q(
    `DELETE FROM idempotency_receipts
     WHERE scope = ANY($2::text[]) AND payload->>'organizationId' = $1`,
    [fixture.organizationId, RECEIPT_SCOPES],
  )
  for (const table of [
    'google_import_discovery_records',
    'authorization_execution_permits',
    'google_import_items',
    'google_imports',
    'google_connections',
    'properties',
  ]) {
    await q(`DELETE FROM ${table} WHERE organization_id = $1`, [fixture.organizationId])
  }
  await withLastOwnerGuardDisabled(lease.pool, (client) =>
    client.query('DELETE FROM member WHERE "organizationId" = $1', [
      fixture.organizationId,
    ]),
  )
  await deleteTestOrganizations(lease.pool, [fixture.organizationId])
  await q('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

const TENANT_TABLES = [
  'google_connections',
  'google_imports',
  'google_import_items',
  'authorization_execution_permits',
] as const

export async function snapshot(organizationId: string): Promise<string> {
  const receipts = await lease.pool.query(
    `SELECT to_jsonb(t.*)::text AS row FROM idempotency_receipts AS t
     WHERE scope = 'google_disconnect_revoke' AND payload->>'organizationId' = $1`,
    [organizationId],
  )
  return [
    await snapshotTenantTables(lease.pool, TENANT_TABLES, organizationId),
    `receipts:${receipts.rows.map((row) => String(row.row)).join('|')}`,
  ].join('\n')
}

export const rowCount = (table: string, organizationId: string) =>
  countRows(lease.pool, table, organizationId)

/** What scripts/ops/rights-request.ts does after the operator harness. */
export const runScript = (
  argv: string[],
  options: { journalStore?: RightsJournalStore } = {},
) =>
  runRightsRequestScript({
    argv,
    store: options.journalStore,
    executors: [createGoogleRightsExecutor({ db, now: () => NOW })],
  })

export const ORGANIZATION_REPORT_LINE =
  'google-integration: connections=1 imports=3 import_items=4 ' +
  'import_discovery_records=1 idempotency_receipts=4 authorization_execution_permits=1'

export const apply = (organizationId: string) => organizationApplyArgv(organizationId)

/** Acquires the shared test lease and removes every seeded Organization after each case. */
export function useGoogleRightsHarness(
  createDb: (pool: TestLease['pool']) => Database,
): void {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = createDb(lease.pool)
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const fixture of fixtures) await cleanup(fixture)
    fixtures.length = 0
  })
}
