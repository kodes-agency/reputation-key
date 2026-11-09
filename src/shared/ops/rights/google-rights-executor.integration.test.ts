// The Google rights executor against real PostgreSQL, driven the way
// scripts/ops/rights-request.ts drives it: parse, plan, run the executors.
// Two tenants are seeded so every case proves the other one is untouched.

import { randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import {
  GOOGLE_RIGHTS_EXPORT_PATH,
  createGoogleRightsExecutor,
  createGoogleRightsReplayers,
} from './google-rights-executor'
import { runRightsExecutors } from './rights-executor'
import { createRightsJournal, type RightsJournalStore } from './rights-journal'
import { planRightsRequest, rightsRequestCommandSpec } from './rights-request-command'

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')
const NOW = new Date('2026-11-08T12:00:00.000Z')

const MARKERS = Object.freeze({
  accessToken: 'RIGHTS_ACCESS_TOKEN',
  refreshToken: 'RIGHTS_REFRESH_TOKEN',
  googleSubject: 'RIGHTS_GOOGLE_SUBJECT',
  providerSuffix: 'rights-provider-suffix',
  replayDigest: `RightsReplayDigest${'0'.repeat(25)}`,
})

type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  propertyId: string
  siblingPropertyId: string
  importId: string
  connectionId: string
  permitId: string
}>

const RECEIPT_SCOPES = [
  'google_oauth_exchange',
  'gbp_import_item_retry',
  'google_import_discovery',
  'google_disconnect_revoke',
]

const fixtures: Fixture[] = []
let lease: TestLease
let db: Database

async function seed(options: { live: boolean }): Promise<Fixture> {
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
  await q(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       credential_authorized_by, credential_authorized_at, visibility, status,
       credential_use_state, last_successful_sync_at, status_reason, status_changed_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $9::text[], $7, $7, $8, 'organization', $10,
       $11, $8, 'connected', $8, $8, $8
     )`,
    [
      fixture.connectionId,
      fixture.organizationId,
      options.live ? `${MARKERS.googleSubject}-${suffix}` : null,
      options.live ? MARKERS.accessToken : 'redacted',
      options.live ? MARKERS.refreshToken : 'redacted',
      new Date(CREATED_AT.getTime() + 3_600_000),
      fixture.userId,
      CREATED_AT,
      options.live ? ['https://www.googleapis.com/auth/business.manage'] : [],
      options.live ? 'active' : 'disconnected',
      options.live ? 'active' : 'none',
    ],
  )
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

async function insertGoogleImport(fixture: Fixture, importId: string): Promise<void> {
  await lease.pool.query(
    `INSERT INTO google_imports (
       id, organization_id, request_id, initiated_by, total_count,
       wire_replay_key_version, wire_replay_digest,
       semantic_replay_key_version, semantic_replay_digest,
       first_terminal_at, purge_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 2, 'wire_v1', $5, 'semantic_v1', $5,
               $6, $6::timestamptz + interval '30 days', $6, $6)`,
    [
      importId,
      fixture.organizationId,
      randomUUID(),
      fixture.userId,
      MARKERS.replayDigest,
      CREATED_AT,
    ],
  )
}

async function insertGoogleItem(
  fixture: Fixture,
  importId: string,
  propertyId: string,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO google_import_items (
       id, organization_id, import_id, destination_property_id,
       action, update_existing_profile, property_name, country_code, timezone,
       status, outcome_code, first_terminal_at, effect_deadline_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'create', true, 'Imported Location', 'US', 'UTC',
               'imported', 'imported', $5, $6, $5, $5)`,
    [
      randomUUID(),
      fixture.organizationId,
      importId,
      propertyId,
      CREATED_AT,
      new Date(CREATED_AT.getTime() + 86_400_000),
    ],
  )
}

async function insertPendingGoogleItem(
  fixture: Fixture,
  importId: string,
  propertyId: string,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO google_import_items (
       id, organization_id, import_id, destination_property_id,
       connection_id, provider_account_suffix, provider_location_suffix,
       expected_connection_lifecycle_version, expected_connection_access_version,
       expected_credential_generation, expected_execution_policy_version,
       expected_actor_role, expected_permission_digest, expected_principal_kind,
       expected_permission_version,
       action, update_existing_profile, property_name, country_code, timezone,
       status, effect_deadline_at, next_dispatch_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, 1, 1, 1, 'v1', 'owner', $7, 'user', 1,
               'create', true, 'Imported Location', 'US', 'UTC',
               'pending', $8, $9, $9, $9)`,
    [
      randomUUID(),
      fixture.organizationId,
      importId,
      propertyId,
      fixture.connectionId,
      MARKERS.providerSuffix,
      'a'.repeat(64),
      new Date(CREATED_AT.getTime() + 86_400_000),
      CREATED_AT,
    ],
  )
}

/** One new-store import with a terminal item for each of the two Properties. */
async function seedGoogleImport(fixture: Fixture): Promise<void> {
  await insertGoogleImport(fixture, fixture.importId)
  for (const propertyId of [fixture.propertyId, fixture.siblingPropertyId]) {
    await insertGoogleItem(fixture, fixture.importId, propertyId)
  }
}

/** An import holding only the Property's item. */
async function seedSoloImports(fixture: Fixture, propertyId: string): Promise<void> {
  const soloImportId = randomUUID()
  await insertGoogleImport(fixture, soloImportId)
  await insertGoogleItem(fixture, soloImportId, propertyId)
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
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${fixture.organizationId}`,
  ])
  await deleteTestOrganizations(lease.pool, [fixture.organizationId])
  await q('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

const TENANT_TABLES = [
  'google_connections',
  'google_imports',
  'google_import_items',
  'authorization_execution_permits',
] as const

async function snapshot(organizationId: string): Promise<string> {
  const parts: string[] = []
  for (const table of TENANT_TABLES) {
    const result = await lease.pool.query(
      `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
       WHERE organization_id = $1 ORDER BY to_jsonb(t.*)::text`,
      [organizationId],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  const receipts = await lease.pool.query(
    `SELECT to_jsonb(t.*)::text AS row FROM idempotency_receipts AS t
     WHERE scope = 'google_disconnect_revoke' AND payload->>'organizationId' = $1`,
    [organizationId],
  )
  parts.push(`receipts:${receipts.rows.map((row) => String(row.row)).join('|')}`)
  return parts.join('\n')
}

async function rowCount(table: string, organizationId: string): Promise<number> {
  const result = await lease.pool.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/** What scripts/ops/rights-request.ts does after the operator harness. */
async function runScript(
  argv: string[],
  options: { production?: boolean; journalStore?: RightsJournalStore } = {},
) {
  const parsed = parseOperatorArgs(
    ['--operator', 'op', ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const ctx = {
    operatorId: 'op',
    correlationId: 'c',
    organizationId: parsed.args.organizationId,
    propertyId: parsed.args.propertyId,
    dryRun: !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  const planned = planRightsRequest(ctx, parsed.args, {
    production: options.production ?? false,
  })
  const out: string[] = []
  const err: string[] = []
  const files = new Map<string, string>()
  if (!planned.ok) return { exit: 1, out, err: [planned.error], files }
  const exit = await runRightsExecutors({
    plan: planned.plan,
    executors: [createGoogleRightsExecutor({ db, now: () => NOW })],
    journal: createRightsJournal(
      options.journalStore ?? { put: async () => {}, alert: () => {} },
    ),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async (path, bytes) => {
      files.set(path, Buffer.from(bytes).toString('utf8'))
    },
  })
  return { exit, out, err, files }
}

const ORGANIZATION_REPORT_LINE =
  'google-integration: connections=1 imports=3 import_items=4 ' +
  'import_discovery_records=1 idempotency_receipts=4 authorization_execution_permits=1'

const VERIFIED = ['verified=2026-11-01T10:00:00Z', 'verification=ticket:123']
const apply = (organizationId: string) => [
  'organization',
  '--org',
  organizationId,
  ...VERIFIED,
  '--reason',
  'closure request',
  '--ticket',
  'T-1',
  `confirm=ERASE ORGANIZATION ${organizationId}`,
  '--apply',
  '--yes',
  'ops:rights-request',
]

describe.sequential('Google rights executor through the rights-request command', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const fixture of fixtures) await cleanup(fixture)
    fixtures.length = 0
  })

  it('exports only the allowlisted lifecycle status of the asked-for tenant', async () => {
    const asked = await seed({ live: true })
    const other = await seed({ live: true })

    const result = await runScript([
      'access',
      '--org',
      asked.organizationId,
      'out=/export',
    ])

    expect(result.exit).toBe(0)
    const file = result.files.get(`/export/${GOOGLE_RIGHTS_EXPORT_PATH}`)
    expect(file).toBeDefined()
    const payload = JSON.parse(file ?? '{}')
    expect(payload.organizationId).toBe(asked.organizationId)
    expect(payload.googleConnections.map((row: { id: string }) => row.id)).toEqual([
      asked.connectionId,
    ])
    expect(payload.importItemStateCounts.length).toBeGreaterThan(0)
    expect(payload.imports.map((row: { id: string }) => row.id)).toEqual([asked.importId])
    expect(
      payload.importItemStateCounts.some(
        (row: { import_job_id: string }) => row.import_job_id === asked.importId,
      ),
    ).toBe(true)
    for (const secret of Object.values(MARKERS)) expect(file).not.toContain(secret)
    expect(file).not.toContain(other.organizationId)
    expect(file).not.toContain(other.connectionId)
  })

  it('refuses a closure while a credential is live and changes nothing for either tenant', async () => {
    const asked = await seed({ live: true })
    const other = await seed({ live: true })
    const before = [
      await snapshot(asked.organizationId),
      await snapshot(other.organizationId),
    ]

    const result = await runScript(apply(asked.organizationId))

    expect(result.exit).toBe(1)
    expect(result.err.join('\n')).toContain('live_connections=1')
    expect(result.err.join('\n')).toContain('Disconnect Google')
    expect([
      await snapshot(asked.organizationId),
      await snapshot(other.organizationId),
    ]).toEqual(before)
  })

  it('closes a disconnected tenant, leaves the other one byte-identical, and converges on replay', async () => {
    const asked = await seed({ live: false })
    const other = await seed({ live: false })
    const otherBefore = await snapshot(other.organizationId)

    const first = await runScript(apply(asked.organizationId))
    expect(first.exit).toBe(0)

    for (const table of ['google_import_items', 'google_imports']) {
      expect(await rowCount(table, asked.organizationId)).toBe(0)
    }
    const connection = await lease.pool.query(
      `SELECT connected_by, status_reason, google_subject, encrypted_refresh_token
       FROM google_connections WHERE organization_id = $1`,
      [asked.organizationId],
    )
    expect(connection.rows).toEqual([
      {
        connected_by: 'purged',
        status_reason: 'organization_purged',
        google_subject: null,
        encrypted_refresh_token: 'redacted',
      },
    ])
    expect(await snapshot(other.organizationId)).toBe(otherBefore)

    const afterFirst = await snapshot(asked.organizationId)
    const second = await runScript(apply(asked.organizationId))
    expect(second.exit).toBe(0)
    expect(await snapshot(asked.organizationId)).toBe(afterFirst)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
  })

  it('reports a tenant without changing it, and refuses an unknown Organization', async () => {
    const asked = await seed({ live: true })
    const before = await snapshot(asked.organizationId)

    const report = await runScript(['organization', '--org', asked.organizationId])
    expect(report.exit).toBe(0)
    expect(report.out.join('\n')).toContain('google-integration: connections=1')
    expect(report.out.join('\n')).toContain('live_connections=1')
    expect(report.out.join('\n')).toContain('imports=1')
    expect(await snapshot(asked.organizationId)).toBe(before)

    const unknown = `rights-missing-${randomUUID()}`
    const refused = await runScript(apply(unknown))
    expect(refused.exit).toBe(1)
    expect(refused.err.join('\n')).toContain('organization not found')
  })

  it('does not apply in production', async () => {
    const asked = await seed({ live: false })
    const before = await snapshot(asked.organizationId)

    const result = await runScript(apply(asked.organizationId), { production: true })

    expect(result.exit).toBe(1)
    expect(result.err.join('\n')).toContain('apply is disabled in production')
    expect(await snapshot(asked.organizationId)).toBe(before)
  })

  it("exports one Property's import items without provider identifiers", async () => {
    const asked = await seed({ live: false })
    await seedSoloImports(asked, asked.propertyId)

    const result = await runScript([
      'access',
      '--org',
      asked.organizationId,
      '--property',
      asked.propertyId,
      'out=/export',
    ])

    expect(result.exit).toBe(0)
    const file = result.files.get(`/export/${GOOGLE_RIGHTS_EXPORT_PATH}`)
    expect(file).toBeDefined()
    const payload = JSON.parse(file ?? '{}')
    expect(payload.propertyId).toBe(asked.propertyId)
    const total = payload.importItems.reduce(
      (sum: number, row: { item_count: number }) => sum + row.item_count,
      0,
    )
    expect(total).toBe(2)
    expect(
      payload.importItems.some(
        (row: { import_job_id: string }) => row.import_job_id === asked.importId,
      ),
    ).toBe(true)
    expect(file).not.toContain(asked.siblingPropertyId)
    for (const secret of Object.values(MARKERS)) expect(file).not.toContain(secret)
  })

  it("erases one Property's import items and prunes emptied parents", async () => {
    const asked = await seed({ live: false })
    await seedSoloImports(asked, asked.propertyId)
    const items = (table: string, column: string, propertyId: string) =>
      lease.pool
        .query(
          `SELECT count(*)::int AS count FROM ${table}
           WHERE organization_id = $1 AND ${column} = $2`,
          [asked.organizationId, propertyId],
        )
        .then((result) => Number(result.rows[0]?.count))
    const propertyArgs = (mode: string[]) => [
      'property',
      '--org',
      asked.organizationId,
      '--property',
      asked.propertyId,
      ...mode,
    ]

    const report = await runScript(propertyArgs([]))
    expect(report.exit).toBe(0)
    expect(report.out.join('\n')).toContain('import_items=2')

    const result = await runScript(
      propertyArgs([
        ...VERIFIED,
        '--reason',
        'erasure request',
        '--ticket',
        'T-2',
        `confirm=ERASE PROPERTY ${asked.propertyId}`,
        '--apply',
        '--yes',
        'ops:rights-request',
      ]),
    )

    expect(result.exit).toBe(0)
    expect(
      await items('google_import_items', 'destination_property_id', asked.propertyId),
    ).toBe(0)
    expect(
      await items(
        'google_import_items',
        'destination_property_id',
        asked.siblingPropertyId,
      ),
    ).toBe(1)
    // The shared import keeps its parent for the sibling; the solo import is gone.
    expect(await rowCount('google_imports', asked.organizationId)).toBe(1)
  })

  it('refuses to erase a Property with an import item in flight', async () => {
    const asked = await seed({ live: false })
    await insertPendingGoogleItem(asked, asked.importId, asked.propertyId)
    const before = await snapshot(asked.organizationId)

    const result = await runScript([
      'property',
      '--org',
      asked.organizationId,
      '--property',
      asked.propertyId,
      ...VERIFIED,
      '--reason',
      'erasure request',
      '--ticket',
      'T-3',
      `confirm=ERASE PROPERTY ${asked.propertyId}`,
      '--apply',
      '--yes',
      'ops:rights-request',
    ])

    expect(result.exit).not.toBe(0)
    expect(result.err.join('\n')).toContain('in_flight_import_items=1')
    expect(await snapshot(asked.organizationId)).toBe(before)
  })

  describe('Property A, Property B and a second Organization', () => {
    type Tenant = Readonly<{ fixture: Fixture }>

    async function seedTenant(live: boolean): Promise<Tenant> {
      const fixture = await seed({ live })
      await seedSoloImports(fixture, fixture.propertyId)
      await seedSoloImports(fixture, fixture.siblingPropertyId)
      return { fixture }
    }

    /** B's import items with the imports they hang on. */
    async function propertySnapshot(fixture: Fixture, propertyId: string) {
      const parts: string[] = []
      const queries: ReadonlyArray<readonly [string, string]> = [
        [
          'google_import_items',
          `SELECT to_jsonb(t.*)::text AS row FROM google_import_items AS t
           WHERE t.organization_id = $1 AND t.destination_property_id = $2`,
        ],
        [
          'google_imports',
          `SELECT to_jsonb(p.*)::text AS row FROM google_imports AS p
           WHERE p.organization_id = $1 AND p.id IN (
             SELECT import_id FROM google_import_items
             WHERE organization_id = $1 AND destination_property_id = $2)`,
        ],
      ]
      for (const [label, query] of queries) {
        const result = await lease.pool.query(query, [fixture.organizationId, propertyId])
        const rows = result.rows.map((row) => String(row.row)).sort()
        parts.push(`${label}:${rows.join('|')}`)
      }
      return parts.join('\n')
    }

    /** The connection, permits and receipts a Property erase never touches. */
    async function controlSnapshot(fixture: Fixture): Promise<string> {
      const parts: string[] = []
      for (const table of ['google_connections', 'authorization_execution_permits']) {
        const result = await lease.pool.query(
          `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
           WHERE organization_id = $1 ORDER BY 1`,
          [fixture.organizationId],
        )
        parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
      }
      return parts.join('\n')
    }

    async function everything(tenant: Tenant) {
      const { fixture } = tenant
      return {
        whole: await snapshot(fixture.organizationId),
        b: await propertySnapshot(fixture, fixture.siblingPropertyId),
        control: await controlSnapshot(fixture),
      }
    }

    function propertyApplyArgs(fixture: Fixture): string[] {
      return [
        'property',
        '--org',
        fixture.organizationId,
        '--property',
        fixture.propertyId,
        ...VERIFIED,
        '--reason',
        'erasure request',
        '--ticket',
        'T-4',
        `confirm=ERASE PROPERTY ${fixture.propertyId}`,
        '--apply',
        '--yes',
        'ops:rights-request',
      ]
    }

    function journalStore(): {
      store: RightsJournalStore
      puts: Map<string, string>
      alerts: unknown[]
    } {
      const puts = new Map<string, string>()
      const alerts: unknown[] = []
      return {
        puts,
        alerts,
        store: {
          put: async (key, bytes) => {
            puts.set(key, bytes)
          },
          alert: (input) => {
            alerts.push(input)
          },
        },
      }
    }

    /** Puts a restore back: every captured row, parents first, existing rows kept. */
    async function restoreRows(
      captured: ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>,
    ): Promise<void> {
      for (const [table, rows] of captured) {
        if (rows.length === 0) continue
        await lease.pool.query(
          `INSERT INTO ${table}
           SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [JSON.stringify(rows)],
        )
      }
    }

    async function captureRows(fixture: Fixture) {
      const captured: Array<readonly [string, ReadonlyArray<unknown>]> = []
      for (const table of ['google_imports', 'google_import_items']) {
        const result = await lease.pool.query(
          `SELECT to_jsonb(t.*) AS row FROM ${table} AS t WHERE organization_id = $1`,
          [fixture.organizationId],
        )
        captured.push([table, result.rows.map((row) => row.row as unknown)])
      }
      return captured
    }

    const propertyItems = async (fixture: Fixture, propertyId: string) =>
      (await propertySnapshot(fixture, propertyId)).split('\n').filter((line) => {
        const [, rows = ''] = line.split(/:(.*)/su)
        return rows.length > 0
      }).length

    const googleReplayers = createGoogleRightsReplayers(() => NOW)

    it('reports the counts of each Property and each Organization', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)

      for (const { fixture } of [asked, other]) {
        for (const propertyId of [fixture.propertyId, fixture.siblingPropertyId]) {
          const report = await runScript([
            'property',
            '--org',
            fixture.organizationId,
            '--property',
            propertyId,
          ])
          expect(report.exit).toBe(0)
          expect(report.out).toContain('google-integration: import_items=2 imports=1')
          expect(report.out).toContain('google-integration: erasure blockers: none')
        }
        const org = await runScript(['organization', '--org', fixture.organizationId])
        expect(org.out).toContain(ORGANIZATION_REPORT_LINE)
        expect(org.out).toContain('google-integration: closure blockers: none')
      }
    })

    /** Every row of a query as text, so a before/after diff needs no report code. */
    async function rowTexts(from: string, where: string, args: unknown[]) {
      const result = await lease.pool.query(
        `SELECT to_jsonb(t.*)::text AS row FROM ${from} AS t WHERE ${where}`,
        args,
      )
      return result.rows.map((row) => String(row.row))
    }

    const reportSources: ReadonlyArray<
      readonly [
        label: string,
        table: string,
        where: string,
        args: (id: string) => unknown[],
      ]
    > = [
      ['connections', 'google_connections', 't.organization_id = $1', (id) => [id]],
      ['imports', 'google_imports', 't.organization_id = $1', (id) => [id]],
      ['import_items', 'google_import_items', 't.organization_id = $1', (id) => [id]],
      [
        'import_discovery_records',
        'google_import_discovery_records',
        't.organization_id = $1',
        (id) => [id],
      ],
      [
        'idempotency_receipts',
        'idempotency_receipts',
        `t.scope = ANY($2::text[]) AND t.payload->>'organizationId' = $1`,
        (id) => [id, RECEIPT_SCOPES],
      ],
      [
        'authorization_execution_permits',
        'authorization_execution_permits',
        't.organization_id = $1',
        (id) => [id],
      ],
    ]

    async function reportedRows(organizationId: string) {
      const rows = new Map<string, string[]>()
      for (const [label, table, where, args] of reportSources) {
        rows.set(label, await rowTexts(table, where, args(organizationId)))
      }
      return rows
    }

    /** Per table, the rows that were deleted or changed in place. */
    function touchedLine(before: Map<string, string[]>, after: Map<string, string[]>) {
      return reportSources
        .map(([label]) => {
          const kept = new Set(after.get(label))
          const touched = (before.get(label) ?? []).filter((row) => !kept.has(row))
          return `${label}=${touched.length}`
        })
        .join(' ')
    }

    async function organizationReport(organizationId: string): Promise<string> {
      const { out } = await runScript(['organization', '--org', organizationId])
      const prefix = 'google-integration: '
      const line = out.find((entry) => entry.startsWith(`${prefix}connections=`))
      return (line ?? '').slice(prefix.length)
    }

    async function propertyReport(fixture: Fixture, propertyId: string) {
      const { out } = await runScript([
        'property',
        '--org',
        fixture.organizationId,
        '--property',
        propertyId,
      ])
      return out.filter((entry) => entry.startsWith('google-integration: import_items='))
    }

    it('reports for an Organization exactly the rows its closure deletes or scrubs', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { organizationId } = asked.fixture
      const otherId = other.fixture.organizationId
      const otherBefore = await reportedRows(otherId)
      const otherReport = await organizationReport(otherId)
      const report = await organizationReport(organizationId)
      const before = await reportedRows(organizationId)

      const result = await runScript(apply(organizationId))

      expect(result.exit).toBe(0)
      const after = await reportedRows(organizationId)
      expect(report).toBe(touchedLine(before, after))
      expect(`google-integration: ${report}`).toBe(ORGANIZATION_REPORT_LINE)
      expect(after.get('import_items')).toEqual([])
      expect(after.get('imports')).toEqual([])
      expect(after.get('import_discovery_records')).toEqual([])
      expect(after.get('idempotency_receipts')).toHaveLength(1)
      expect(await reportedRows(otherId)).toEqual(otherBefore)
      expect(await organizationReport(otherId)).toBe(otherReport)
    })

    it('reports for a Property exactly the items and imports its erase deletes', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { fixture } = asked
      const count = async (table: string) =>
        (await rowTexts(table, 't.organization_id = $1', [fixture.organizationId])).length
      const itemsBefore = await count('google_import_items')
      const importsBefore = await count('google_imports')
      const report = await propertyReport(fixture, fixture.propertyId)
      const otherReport = await propertyReport(other.fixture, other.fixture.propertyId)

      const result = await runScript(propertyApplyArgs(fixture))

      expect(result.exit).toBe(0)
      const items = itemsBefore - (await count('google_import_items'))
      const imports = importsBefore - (await count('google_imports'))
      expect(report).toEqual([
        `google-integration: import_items=${items} imports=${imports}`,
      ])
      expect([items, imports]).toEqual([2, 1])
      expect(await propertyReport(other.fixture, other.fixture.propertyId)).toEqual(
        otherReport,
      )
    })

    it('erases A, leaves B and the other Organization byte-identical, and replays a restore', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { fixture } = asked
      const before = await everything(asked)
      const otherBefore = await snapshot(other.fixture.organizationId)
      const restoreSet = await captureRows(fixture)
      const journal = journalStore()

      const result = await runScript(propertyApplyArgs(fixture), {
        journalStore: journal.store,
      })

      expect(result.exit).toBe(0)
      expect(await propertyItems(fixture, fixture.propertyId)).toBe(0)
      const after = await everything(asked)
      expect(after.b).toBe(before.b)
      expect(after.control).toBe(before.control)
      expect(after.whole).not.toBe(before.whole)
      expect(await snapshot(other.fixture.organizationId)).toBe(otherBefore)

      const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        context: 'integration',
        subjectClass: 'property',
        propertyId: fixture.propertyId,
      })

      await restoreRows(restoreSet)
      expect(await snapshot(fixture.organizationId)).toBe(before.whole)
      expect(await propertyItems(fixture, fixture.propertyId)).toBeGreaterThan(0)

      const fence = await db.transaction((tx) =>
        applyRestoreResurrectionFence(tx, {
          entries,
          restorePointAt: new Date(NOW.getTime() - 86_400_000),
          replayers: googleReplayers,
        }),
      )

      expect(fence.verified).toBe(true)
      expect(fence.counts.ledgerEntriesReapplied).toBe(1)
      expect(fence.counts.ledgerRowsReErased).toBeGreaterThan(0)
      expect(await propertyItems(fixture, fixture.propertyId)).toBe(0)
      const replayed = await everything(asked)
      expect(replayed.whole).toBe(after.whole)
      expect(replayed.b).toBe(before.b)
      expect(replayed.control).toBe(before.control)
      expect(await snapshot(other.fixture.organizationId)).toBe(otherBefore)
    })

    it('scrubs credentials a restore brings back when an Organization closure is replayed', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { fixture } = asked
      const otherBefore = await snapshot(other.fixture.organizationId)
      const restoreSet = await captureRows(fixture)
      const journal = journalStore()

      const result = await runScript(apply(fixture.organizationId), {
        journalStore: journal.store,
      })

      expect(result.exit).toBe(0)
      const erased = await snapshot(fixture.organizationId)
      const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        context: 'integration',
        subjectClass: 'organization',
      })

      await restoreRows(restoreSet)
      await lease.pool.query(
        `UPDATE google_connections
         SET google_subject = $2, encrypted_access_token = $3,
             encrypted_refresh_token = $4, credential_use_state = 'active',
             status = 'active', connected_by = $5
         WHERE organization_id = $1`,
        [
          fixture.organizationId,
          MARKERS.googleSubject,
          MARKERS.accessToken,
          MARKERS.refreshToken,
          fixture.userId,
        ],
      )
      expect(await snapshot(fixture.organizationId)).not.toBe(erased)

      const fence = await db.transaction((tx) =>
        applyRestoreResurrectionFence(tx, {
          entries,
          restorePointAt: new Date(NOW.getTime() - 86_400_000),
          replayers: googleReplayers,
        }),
      )

      expect(fence.verified).toBe(true)
      expect(fence.counts.ledgerEntriesReapplied).toBe(1)
      expect(await snapshot(fixture.organizationId)).toBe(erased)
      expect(await snapshot(other.fixture.organizationId)).toBe(otherBefore)
    })

    it('changes nothing and raises the alert when the journal write is rejected', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const before = [
        await snapshot(asked.fixture.organizationId),
        await snapshot(other.fixture.organizationId),
      ]
      const alerts: unknown[] = []

      const result = await runScript(propertyApplyArgs(asked.fixture), {
        journalStore: {
          put: async () => {
            throw new Error('bucket unavailable')
          },
          alert: (input) => {
            alerts.push(input)
          },
        },
      })

      expect(result.exit).not.toBe(0)
      expect(alerts).toHaveLength(1)
      expect(result.err.join('\n')).toContain('Erasure journal write failed')
      expect([
        await snapshot(asked.fixture.organizationId),
        await snapshot(other.fixture.organizationId),
      ]).toEqual(before)
    })

    it('refuses an Organization closure with a live connection and leaves both Organizations unchanged', async () => {
      const asked = await seedTenant(true)
      const other = await seedTenant(false)
      const journal = journalStore()
      const before = [
        await snapshot(asked.fixture.organizationId),
        await snapshot(other.fixture.organizationId),
      ]

      const result = await runScript(apply(asked.fixture.organizationId), {
        journalStore: journal.store,
      })

      expect(result.exit).toBe(1)
      expect(result.err.join('\n')).toContain('live_connections=1')
      expect(result.err.join('\n')).toContain('nothing was changed')
      expect(journal.puts.size).toBe(0)
      expect([
        await snapshot(asked.fixture.organizationId),
        await snapshot(other.fixture.organizationId),
      ]).toEqual(before)
    })
  })
})
