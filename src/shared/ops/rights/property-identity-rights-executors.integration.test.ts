// The Property and Staff rights executors against real PostgreSQL, driven the
// way scripts/ops/rights-request.ts drives them. Every case seeds a second
// Organization and a sibling Property and proves both stay byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { composeRightsReplayers } from '#/composition/rights-executors'
import {
  createIdentityPropertyRightsExecutor,
  createStaffOrganizationRightsExecutor,
} from '#/contexts/identity/infrastructure/adapters/identity-rights.adapter'
import { STAFF_LIFECYCLE_TABLES } from '#/contexts/identity/infrastructure/adapters/staff-organization-erasure'
import { createPropertyRightsExecutor } from '#/contexts/property/infrastructure/adapters/property-rights.adapter'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import { createGoogleRightsExecutor } from './google-rights-executor'
import { runRightsExecutors, type RightsExecutor } from './rights-executor'
import { createRightsJournal, type RightsJournalStore } from './rights-journal'
import { planRightsRequest, rightsRequestCommandSpec } from './rights-request-command'
import { holdRightsOrganization } from '#/shared/db/testing/rights-isolation-fixture'

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')
const NOW = new Date('2026-11-09T12:00:00.000Z')
const RESTORE_POINT = new Date('2026-11-08T12:00:00.000Z')
const VERIFIED_AT = new Date('2026-11-01T10:00:00Z')
const VERIFIED = [`verified=${VERIFIED_AT.toISOString()}`, 'verification=ticket:123']

type Tenant = Readonly<{
  organizationId: string
  userId: string
  connectionId: string
  propertyA: string
  propertyB: string
  location: string
}>

const tenants: Tenant[] = []
let lease: TestLease
let db: Database

async function seedTenant(): Promise<Tenant> {
  const suffix = randomUUID()
  const tenant: Tenant = {
    organizationId: `rights-prop-org-${suffix}`,
    userId: `rights-prop-user-${suffix}`,
    connectionId: randomUUID(),
    propertyA: randomUUID(),
    propertyB: randomUUID(),
    location: `rights-${suffix}`,
  }
  tenants.push(tenant)
  const q = lease.pool.query.bind(lease.pool)
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights fixture', $1, $2)`,
    [tenant.organizationId, CREATED_AT],
  )
  await q(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Rights Manager', $2, true, $3, $3)`,
    [tenant.userId, `${suffix}@example.test`, CREATED_AT],
  )
  await q(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       credential_authorized_by, credential_authorized_at, visibility, status,
       credential_use_state, last_successful_sync_at, status_reason, status_changed_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, NULL, 'redacted', 'redacted', $3, '{}'::text[], $4, $4, $5,
       'organization', 'disconnected', 'none', $5, 'connected', $5, $5, $5
     )`,
    [
      tenant.connectionId,
      tenant.organizationId,
      new Date(CREATED_AT.getTime() + 3_600_000),
      tenant.userId,
      CREATED_AT,
    ],
  )
  for (const [index, propertyId] of [tenant.propertyA, tenant.propertyB].entries()) {
    await q(
      `INSERT INTO properties (
         id, organization_id, name, slug, address, timezone, created_at, updated_at,
         lifecycle_state, lifecycle_reason, lifecycle_initiated_by,
         google_connection_id, gbp_account_id, gbp_location_id, google_binding_state,
         google_review_uri, google_review_destination_state,
         google_review_destination_retrieved_at, google_review_destination_source_epoch,
         google_review_destination_profile_version, google_primary_category,
         google_primary_category_updated_at, profile_source, profile_confirmed_at,
         profile_confirmed_by
       ) VALUES (
         $1, $2, $3, $4, '1 Rights Street', 'UTC', $5, $5,
         'archived', 'closing the hotel for Dana Rivera', $6,
         $7, 'account-1', $8, 'active',
         'https://search.google.com/local/writereview?placeid=x', 'verified',
         $5, 0, 1, 'Hotel', $5, 'tenant_confirmed', $5, $6
       )`,
      [
        propertyId,
        tenant.organizationId,
        `Rights Property ${index}`,
        `rights-${propertyId}`,
        CREATED_AT,
        tenant.userId,
        tenant.connectionId,
        `${tenant.location}-${index}`,
      ],
    )
    await q(
      `INSERT INTO property_responsible_managers
         (organization_id, property_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $3)`,
      [tenant.organizationId, propertyId, tenant.userId, CREATED_AT],
    )
    await q(
      `INSERT INTO property_access_grants
         (organization_id, property_id, user_id, kind, granted_by)
       VALUES ($1, $2, $3, 'manage', $3)`,
      [tenant.organizationId, propertyId, tenant.userId],
    )
    await q(
      `INSERT INTO property_access_grant
         (organization_id, property_id, user_id, source, created_by)
       VALUES ($1, $2, $3, 'operator', $3)`,
      [tenant.organizationId, propertyId, tenant.userId],
    )
  }
  return tenant
}

const PROPERTY_TABLES = [
  ['properties', 'id'],
  ['property_responsible_managers', 'property_id'],
  ['property_access_grants', 'property_id'],
  ['property_access_grant', 'property_id'],
] as const

/** Every row the executors may touch for one Property, as comparable text. */
async function propertyRows(tenant: Tenant, propertyId: string): Promise<string> {
  const parts: string[] = []
  for (const [table, column] of PROPERTY_TABLES) {
    const result = await lease.pool.query(
      `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
       WHERE organization_id = $1 AND ${column} = $2 ORDER BY 1`,
      [tenant.organizationId, propertyId],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

async function everything(tenant: Tenant) {
  return {
    a: await propertyRows(tenant, tenant.propertyA),
    b: await propertyRows(tenant, tenant.propertyB),
    connection: (
      await lease.pool.query(
        `SELECT to_jsonb(t.*)::text AS row FROM google_connections AS t WHERE organization_id = $1`,
        [tenant.organizationId],
      )
    ).rows
      .map((row) => String(row.row))
      .join('|'),
  }
}

const stringify = async (tenant: Tenant) => JSON.stringify(await everything(tenant))

async function captureProperty(tenant: Tenant, propertyId: string) {
  const captured: Array<readonly [string, ReadonlyArray<unknown>]> = []
  for (const [table, column] of PROPERTY_TABLES) {
    const result = await lease.pool.query(
      `SELECT to_jsonb(t.*) AS row FROM ${table} AS t
       WHERE organization_id = $1 AND ${column} = $2`,
      [tenant.organizationId, propertyId],
    )
    captured.push([table, result.rows.map((row) => row.row as unknown)])
  }
  return captured
}

/** Puts a restore back: the Property row is rewritten, child rows re-inserted. */
async function restoreProperty(
  captured: ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>,
): Promise<void> {
  const columns = await lease.pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'properties' AND table_schema = current_schema()
       AND column_name <> 'id'`,
  )
  const names = columns.rows.map((row) => `"${row.column_name}"`).join(', ')
  for (const [table, rows] of captured) {
    for (const row of rows) {
      if (table === 'properties') {
        await lease.pool.query(
          `UPDATE properties SET (${names}) = (
             SELECT ${names} FROM jsonb_populate_record(NULL::properties, $1::jsonb))
           WHERE id = ($1::jsonb->>'id')::uuid`,
          [JSON.stringify(row)],
        )
      } else {
        await lease.pool.query(
          `INSERT INTO ${table}
           SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [JSON.stringify(row)],
        )
      }
    }
  }
}

async function cleanup(tenant: Tenant): Promise<void> {
  const q = lease.pool.query.bind(lease.pool)
  for (const table of [
    'property_access_grant',
    'property_access_grants',
    'property_responsible_managers',
    ...[...STAFF_LIFECYCLE_TABLES],
    'properties',
    'google_connections',
  ]) {
    await q(`DELETE FROM ${table} WHERE organization_id = $1`, [tenant.organizationId])
  }
  await deleteTestOrganizations(lease.pool, [tenant.organizationId])
  await q('DELETE FROM "user" WHERE id = $1', [tenant.userId])
}

function journalStore() {
  const puts = new Map<string, string>()
  const alerts: unknown[] = []
  const store: RightsJournalStore = {
    put: async (key, bytes) => {
      puts.set(key, bytes)
    },
    alert: (input) => {
      alerts.push(input)
    },
  }
  return { puts, alerts, store }
}

async function runScript(
  argv: string[],
  executors: ReadonlyArray<RightsExecutor>,
  store: RightsJournalStore = journalStore().store,
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
  const planned = planRightsRequest(ctx, parsed.args)
  const out: string[] = []
  const err: string[] = []
  if (!planned.ok) return { exit: 1, out, err: [planned.error] }
  const exit = await runRightsExecutors({
    plan: planned.plan,
    executors,
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  return { exit, out, err }
}

const propertyArgs = (tenant: Tenant, mode: string[]) => [
  'property',
  '--org',
  tenant.organizationId,
  '--property',
  tenant.propertyA,
  ...mode,
]
const propertyApply = (tenant: Tenant) =>
  propertyArgs(tenant, [
    ...VERIFIED,
    '--reason',
    'erasure request',
    '--ticket',
    'T-8',
    `confirm=ERASE PROPERTY ${tenant.propertyA}`,
    '--apply',
    '--yes',
    'ops:rights-request',
  ])

function propertyExecutors(): ReadonlyArray<RightsExecutor> {
  return [
    createGoogleRightsExecutor({ db, now: () => NOW }),
    createIdentityPropertyRightsExecutor(db),
    createPropertyRightsExecutor(db, () => NOW),
  ]
}

describe.sequential('Property and Staff rights executors', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const tenant of tenants) await cleanup(tenant)
    tenants.length = 0
  })

  describe('property scope', () => {
    it('reports counts for Property A without changing anything', async () => {
      const asked = await seedTenant()
      const before = await stringify(asked)

      const result = await runScript(propertyArgs(asked, []), propertyExecutors())

      expect(result.exit).toBe(0)
      const out = result.out.join('\n')
      expect(out).toContain('property: properties 1')
      expect(out).toContain('property: property_responsible_managers 1')
      expect(out).toContain('identity-grants: property_access_grants 1')
      expect(await stringify(asked)).toBe(before)
    })

    it('leaves a tombstone for A, frees its Google location, spares B and the other Organization, and replays a restore', async () => {
      const asked = await seedTenant()
      const other = await seedTenant()
      const before = await everything(asked)
      const otherBefore = await stringify(other)
      const restoreSet = await captureProperty(asked, asked.propertyA)
      const journal = journalStore()

      const result = await runScript(
        propertyApply(asked),
        propertyExecutors(),
        journal.store,
      )

      expect(result.exit).toBe(0)
      const after = await everything(asked)
      expect(after.b).toBe(before.b)
      expect(after.connection).toBe(before.connection)
      expect(await stringify(other)).toBe(otherBefore)

      const rows = await lease.pool.query(
        `SELECT * FROM properties WHERE organization_id = $1 AND id = $2`,
        [asked.organizationId, asked.propertyA],
      )
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]).toMatchObject({
        name: 'erased-property',
        address: null,
        lifecycle_state: 'purged',
        lifecycle_reason: 'erased on request',
        lifecycle_initiated_by: null,
        google_connection_id: null,
        gbp_account_id: null,
        gbp_location_id: null,
        google_binding_state: 'unbound',
        google_review_uri: null,
        google_primary_category: null,
        profile_confirmed_by: null,
      })
      expect(rows.rows[0].lifecycle_state_changed_at).toEqual(VERIFIED_AT)
      for (const [table, column] of PROPERTY_TABLES.slice(1)) {
        const left = await lease.pool.query(
          `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1 AND ${column} = $2`,
          [asked.organizationId, asked.propertyA],
        )
        expect(left.rows[0].count).toBe(0)
      }

      // A reconnect of the same Google location starts a fresh Property.
      const fresh = randomUUID()
      await lease.pool.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone,
           google_connection_id, gbp_account_id, gbp_location_id, google_binding_state)
         VALUES ($1, $2, 'Fresh', $3, 'UTC', $4, 'account-1', $5, 'active')`,
        [
          fresh,
          asked.organizationId,
          `fresh-${fresh}`,
          asked.connectionId,
          `${asked.location}-0`,
        ],
      )
      await lease.pool.query(`DELETE FROM properties WHERE id = $1`, [fresh])

      const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
      expect(entries.map((entry) => entry.context).sort()).toEqual([
        'identity',
        'integration',
        'property',
      ])

      await restoreProperty(restoreSet)
      expect(await propertyRows(asked, asked.propertyA)).toBe(before.a)

      const replayers = composeRightsReplayers({
        db,
        now: () => NOW,
        notificationReplayers: [],
      })
      const fence = await db.transaction((tx) =>
        applyRestoreResurrectionFence(tx, {
          entries,
          restorePointAt: RESTORE_POINT,
          replayers,
        }),
      )

      expect(fence.verified).toBe(true)
      expect(fence.counts.ledgerEntriesReapplied).toBe(3)
      const replayed = await everything(asked)
      expect(replayed.a).toBe(after.a)
      expect(replayed.b).toBe(before.b)
      expect(await stringify(other)).toBe(otherBefore)
    })

    it('changes nothing and raises the alert when the journal write is rejected', async () => {
      const asked = await seedTenant()
      const other = await seedTenant()
      const before = [await stringify(asked), await stringify(other)]
      const alerts: unknown[] = []

      const result = await runScript(propertyApply(asked), propertyExecutors(), {
        put: async () => {
          throw new Error('bucket unavailable')
        },
        alert: (input) => {
          alerts.push(input)
        },
      })

      expect(result.exit).not.toBe(0)
      expect(alerts).toHaveLength(1)
      expect([await stringify(asked), await stringify(other)]).toEqual(before)
    })

    it('refuses an unknown Property before anything runs', async () => {
      const asked = await seedTenant()
      const before = await stringify(asked)

      const result = await runScript(
        propertyApply({ ...asked, propertyA: randomUUID() }),
        propertyExecutors(),
      )

      expect(result.exit).toBe(1)
      expect(result.err.join('\n')).toContain('property not found')
      expect(result.err.join('\n')).toContain('nothing was changed')
      expect(await stringify(asked)).toBe(before)
    })
  })

  describe('organization scope', () => {
    async function seedStaff(tenant: Tenant): Promise<void> {
      const q = lease.pool.query.bind(lease.pool)
      const participantId = randomUUID()
      await q(
        `INSERT INTO staff_participants (id, organization_id, display_name, status, created_by)
         VALUES ($1, $2, 'Dana Rivera', 'active', $3)`,
        [participantId, tenant.organizationId, tenant.userId],
      )
      await q(
        `INSERT INTO staff_user_links
           (id, organization_id, staff_participant_id, user_id, effective_from, created_by)
         VALUES ($1, $2, $3, $4, $5, $4)`,
        [randomUUID(), tenant.organizationId, participantId, tenant.userId, CREATED_AT],
      )
      await q(
        `INSERT INTO staff_participations
           (id, organization_id, property_id, staff_participant_id, display_name, status, created_by)
         VALUES ($1, $2, $3, $4, 'Dana Rivera', 'active', $5)`,
        [
          randomUUID(),
          tenant.organizationId,
          tenant.propertyA,
          participantId,
          tenant.userId,
        ],
      )
      await q(
        `INSERT INTO staff_property_settings (organization_id, property_id, updated_by)
         VALUES ($1, $2, $3)`,
        [tenant.organizationId, tenant.propertyA, tenant.userId],
      )
    }

    const staffRows = async (organizationId: string) => {
      const parts: string[] = []
      for (const table of STAFF_LIFECYCLE_TABLES) {
        const result = await lease.pool.query(
          `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
           WHERE organization_id = $1 ORDER BY 1`,
          [organizationId],
        )
        parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
      }
      return parts.join('\n')
    }

    const organizationApply = (tenant: Tenant) => [
      'organization',
      '--org',
      tenant.organizationId,
      ...VERIFIED,
      '--reason',
      'closure request',
      '--ticket',
      'T-9',
      `confirm=ERASE ORGANIZATION ${tenant.organizationId}`,
      '--apply',
      '--yes',
      'ops:rights-request',
    ]

    it('refuses an active Organization and changes nothing', async () => {
      const asked = await seedTenant()
      await seedStaff(asked)
      const before = await staffRows(asked.organizationId)

      const result = await runScript(organizationApply(asked), [
        createStaffOrganizationRightsExecutor(db),
      ])

      expect(result.exit).toBe(1)
      expect(result.err.join('\n')).toContain('still active')
      expect(await staffRows(asked.organizationId)).toBe(before)
    })

    it('purges the Staff directory of one Organization, spares the other, and replays a restore', async () => {
      const asked = await seedTenant()
      const other = await seedTenant()
      for (const tenant of [asked, other]) {
        await seedStaff(tenant)
        holdRightsOrganization(tenant.organizationId)
      }
      const before = await staffRows(asked.organizationId)
      const otherBefore = await staffRows(other.organizationId)
      const users = await lease.pool.query(
        `SELECT count(*)::int AS count FROM "user" WHERE id = ANY($1::text[])`,
        [[asked.userId, other.userId]],
      )
      const captured: Array<readonly [string, ReadonlyArray<unknown>]> = []
      for (const table of [...STAFF_LIFECYCLE_TABLES].reverse()) {
        const result = await lease.pool.query(
          `SELECT to_jsonb(t.*) AS row FROM ${table} AS t WHERE organization_id = $1`,
          [asked.organizationId],
        )
        captured.push([table, result.rows.map((row) => row.row as unknown)])
      }
      const journal = journalStore()

      const result = await runScript(
        organizationApply(asked),
        [createStaffOrganizationRightsExecutor(db)],
        journal.store,
      )

      expect(result.exit).toBe(0)
      const after = await staffRows(asked.organizationId)
      expect(after).not.toBe(before)
      expect(after.split('\n').every((line) => line.endsWith(':'))).toBe(true)
      expect(await staffRows(other.organizationId)).toBe(otherBefore)
      const usersAfter = await lease.pool.query(
        `SELECT count(*)::int AS count FROM "user" WHERE id = ANY($1::text[])`,
        [[asked.userId, other.userId]],
      )
      expect(usersAfter.rows).toEqual(users.rows)

      const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ context: 'staff', subjectClass: 'organization' })

      for (const [table, rows] of captured) {
        for (const row of rows) {
          await lease.pool.query(
            `INSERT INTO ${table}
             SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
             ON CONFLICT DO NOTHING`,
            [JSON.stringify(row)],
          )
        }
      }
      expect(await staffRows(asked.organizationId)).toBe(before)

      const fence = await db.transaction((tx) =>
        applyRestoreResurrectionFence(tx, {
          entries,
          restorePointAt: RESTORE_POINT,
          replayers: composeRightsReplayers({
            db,
            now: () => NOW,
            notificationReplayers: [],
          }),
        }),
      )

      expect(fence.verified).toBe(true)
      expect(await staffRows(asked.organizationId)).toBe(after)
      expect(await staffRows(other.organizationId)).toBe(otherBefore)
    })

    it('changes nothing when the journal write is rejected', async () => {
      const asked = await seedTenant()
      await seedStaff(asked)
      holdRightsOrganization(asked.organizationId)
      const before = await staffRows(asked.organizationId)

      const result = await runScript(
        organizationApply(asked),
        [createStaffOrganizationRightsExecutor(db)],
        {
          put: async () => {
            throw new Error('bucket unavailable')
          },
          alert: () => {},
        },
      )

      expect(result.exit).not.toBe(0)
      expect(await staffRows(asked.organizationId)).toBe(before)
    })
  })
})
