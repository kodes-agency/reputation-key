// The composed rights executors, run the way `pnpm ops rights-request` runs
// them: the subject check, every covering executor's preflight, then each
// apply behind its journal entries. Against real PostgreSQL, the target
// Organization's Properties hold Portal, Staff, Guest and Reporting rows that
// reference each other through blocking foreign keys, beside Identity rows
// (an owner's membership among them) and audit records, and a second
// Organization holds the same.
//
// A Property erasure and an Organization closure remove everything of the
// target and leave the rest byte-identical; each context is journaled before
// its rows go, in apply order. A closure stopped by a failed journal write
// finishes on a rerun with the same journal entries and nothing deleted twice.
// A replay after a restore re-erases in apply order.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createNotificationRightsPort,
  runNotificationRights,
} from '#/contexts/feed/rights/executor.server'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import { writeAuditEvent } from '#/contexts/feed/audit/write.server'
import { getEnv, resetEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  applyRestoreResurrectionFence,
  type BackupErasureLedgerEntry,
  type BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { rightsSubjectRefusal } from '#/shared/db/lifecycle/rights-subject-store'
import {
  holdRightsOrganization,
  rightsPlan,
  RIGHTS_FIXTURE_AT,
  seedRightsOrganization,
  type RightsQuery,
} from '#/shared/db/testing/rights-isolation-fixture'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { composeRightsExecutors, composeRightsReplayers } from './rights-executors'

const SECRET = 'audit-pseudonym-test-secret'
const AT = RIGHTS_FIXTURE_AT
const STAFF_FROM = new Date(AT.getTime() - 3_600_000)
const RESTORE_POINT = new Date(AT.getTime() - 86_400_000)
const IP = '203.0.113.9'

/**
 * The rows the fixture seeds that an erasure deletes, parents first, so a
 * restore can put them back in this order. `property` is false for the rows of
 * the Organization itself, which a Property erasure leaves alone.
 */
const DELETED_TABLES = [
  { table: 'portal_groups', property: true },
  { table: 'portals', property: true },
  { table: 'portal_media_assets', property: true },
  { table: 'staff_participants', property: false },
  { table: 'staff_participations', property: true },
  { table: 'portal_responsibilities', property: true },
  { table: 'portal_group_memberships', property: true },
  { table: 'guest_responses', property: true },
  { table: 'scan_events', property: true },
  { table: 'metric_readings', property: true },
  { table: 'goal_programs', property: true },
  { table: 'property_access_grant', property: true },
  { table: 'member', property: false },
  { table: 'invitation', property: false },
] as const

/** Rows an erasure changes in place: tombstoned or pseudonymised, never deleted. */
const KEPT_TABLES = ['properties', 'audit_events', 'audit_logs'] as const

const ORGANIZATION_COLUMN: Readonly<Record<string, string>> = {
  member: '"organizationId"',
  invitation: '"organizationId"',
}

const inScope = (table: string) => (propertyId?: string) =>
  `SELECT count(*)::int AS n FROM ${table} t WHERE ${where(table, propertyId)}`

/**
 * Per journal context, the count of the scope's rows that are still as seeded:
 * above zero when the context is journaled proves the entry came first.
 */
const STILL_THERE: Readonly<Record<string, (propertyId?: string) => string>> = {
  guest: inScope('guest_responses'),
  metric: inScope('metric_readings'),
  goal: inScope('goal_programs'),
  staff: inScope('staff_participations'),
  portal: inScope('portals'),
  identity: inScope('property_access_grant'),
  activity: (propertyId) =>
    `${inScope('audit_events')(propertyId)}
     AND t.actor_type = 'user' AND t.actor_id NOT LIKE 'pseudonym:%'`,
  property: (propertyId) =>
    `SELECT count(*)::int AS n FROM properties t
     WHERE t.organization_id = $1 ${propertyId ? 'AND t.id::text = $2' : ''}
       AND t.lifecycle_state <> 'purged'`,
}

let lease: TestLease
let db: Database
let query: RightsQuery
const organizations: string[] = []
const users: string[] = []

type Seeded = Readonly<{ organizationId: string; propertyIds: readonly string[] }>

async function seedUser(name: string): Promise<string> {
  const id = `rights-run-${randomUUID()}`
  users.push(id)
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.test`, AT],
  )
  return id
}

/** Portal, Staff, Guest, Reporting, Identity and audit rows of one Property. */
async function seedProperty(organizationId: string, propertyId: string) {
  const [portal, personal, group, participant, participation, responsibility, media] =
    Array.from({ length: 7 }, () => randomUUID())
  const grantee = await seedUser('Sam Lee')
  const statements: Array<[string, unknown[]]> = [
    [
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, 'Front desk')`,
      [group, organizationId, propertyId],
    ],
    [
      `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $3::text, 'Front Desk', $1::text, $4, $4)`,
      [portal, organizationId, propertyId, AT],
    ],
    [
      `INSERT INTO portals (id, organization_id, property_id, entity_id, kind, public_name, name, slug,
                            created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $3::text, 'personal', 'Dana', 'Dana', $1::text, $4, $4)`,
      [personal, organizationId, propertyId, AT],
    ],
    [
      `INSERT INTO portal_media_assets (id, organization_id, property_id, purpose, object_key,
         content_type, width, height, byte_size, content_sha256, source_format, source_bytes,
         rights_confirmed_at, created_by)
       VALUES ($1::uuid, $2, $3, 'hero', 'portal-media/' || $1::text || '.webp', 'image/webp', 1, 1, 1,
               $4, 'webp', 1, $5, 'seed')`,
      [media, organizationId, propertyId, 'a'.repeat(64), AT],
    ],
    [
      `INSERT INTO staff_participants (id, organization_id, display_name, created_by)
       VALUES ($1, $2, 'Dana Rivera', 'seed')`,
      [participant, organizationId],
    ],
    [
      `INSERT INTO staff_participations (id, organization_id, property_id, staff_participant_id,
         personal_portal_id, display_name, started_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Dana Rivera', $6, 'seed')`,
      [participation, organizationId, propertyId, participant, personal, STAFF_FROM],
    ],
    [
      `INSERT INTO portal_responsibilities (id, organization_id, property_id, portal_id,
         staff_participation_id, kind, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'primary', $6, 'seed')`,
      [responsibility, organizationId, propertyId, portal, participation, STAFF_FROM],
    ],
    [
      `INSERT INTO portal_group_memberships (organization_id, property_id, portal_id,
         portal_group_id, created_by)
       VALUES ($1, $2, $3, $4, 'seed')`,
      [organizationId, propertyId, portal, group],
    ],
    [
      `INSERT INTO guest_responses (id, organization_id, property_id, portal_id, status, rating,
         response_consent, text_consent, private_feedback_threshold, correction_count,
         submitted_at, retention_deadline, attributed_staff_participant_id,
         attributed_staff_participation_id, attribution_responsibility_id,
         staff_attribution_effective_from, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'submitted', 4, true, false, 3, 0, $5,
               $5::timestamptz + interval '700 days', $6, $7, $8, $9, $5, $5)`,
      [
        randomUUID(),
        organizationId,
        propertyId,
        portal,
        AT,
        participant,
        participation,
        responsibility,
        STAFF_FROM,
      ],
    ],
    [
      `INSERT INTO scan_events (id, organization_id, portal_id, property_id, source, session_id,
         ip_hash, created_at)
       VALUES ($1, $2, $3, $4, 'qr', $5, 'fixture-hash', $6)`,
      [randomUUID(), organizationId, portal, propertyId, randomUUID(), AT],
    ],
    [
      `INSERT INTO metric_readings (organization_id, property_id, portal_id, metric_key, value,
         recorded_at, attributed_staff_participant_id, attributed_staff_participation_id,
         attribution_responsibility_id, staff_attribution_effective_from)
       VALUES ($1, $2, $3, 'portal.rating', 4, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        propertyId,
        portal,
        AT,
        participant,
        participation,
        responsibility,
        STAFF_FROM,
      ],
    ],
    [
      `INSERT INTO goal_programs (id, organization_id, property_id, name, status,
         current_version, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'Rating goal', 'paused', 1, 'seed', $4, $4)`,
      [randomUUID(), organizationId, propertyId, AT],
    ],
    [
      `INSERT INTO property_access_grant (organization_id, property_id, user_id, source)
       VALUES ($1, $2, $3, 'operator')`,
      [organizationId, propertyId, grantee],
    ],
    [
      `INSERT INTO audit_events (organization_id, property_id, actor_type, actor_id, action,
         outcome, resource_type, resource_id, source_kind, source_id, occurred_at)
       VALUES ($1, $2, 'user', $3, 'member.role_changed', 'succeeded', 'member', $3,
               'interactive_command', $4, $5)`,
      [organizationId, propertyId, grantee, `source-${randomUUID()}`, AT],
    ],
    [
      `INSERT INTO audit_logs (id, organization_id, user_id, action, resource_type,
         resource_id, details, ip_address)
       VALUES (gen_random_uuid()::text, $1, $2, 'goal.program.status_changed',
               'goal_program', 'program-1', $3::jsonb, $4)`,
      [
        organizationId,
        grantee,
        JSON.stringify({
          propertyId,
          reason: 'Sam asked',
          contact: `${grantee}@example.test`,
        }),
        IP,
      ],
    ],
  ]
  for (const [text, params] of statements) await query(text, params)
}

/** An Organization with an owner, a pending invitation and `count` seeded Properties. */
async function seedOrganization(count: number): Promise<Seeded> {
  const seeded = await seedRightsOrganization(query, count, seedProperty)
  organizations.push(seeded.organizationId)
  const owner = await seedUser('Dana Rivera')
  await query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [randomUUID(), owner, seeded.organizationId, AT],
  )
  await query(
    `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt",
       "propertyIds", "inviterId", "createdAt")
     VALUES ($1, $2, $3, 'member', 'pending', $4, $5, $6, $4)`,
    [
      randomUUID(),
      seeded.organizationId,
      `invitee-${randomUUID()}@example.test`,
      AT,
      JSON.stringify(seeded.propertyIds),
      owner,
    ],
  )
  return seeded
}

function where(table: string, propertyId?: string): string {
  const organization = `t.${ORGANIZATION_COLUMN[table] ?? 'organization_id'} = $1`
  return propertyId ? `${organization} AND t.property_id::text = $2` : organization
}

type Rows = Readonly<Record<string, unknown[]>>

/** Every fixture table's rows of an Organization, or of one of its Properties. */
async function rowsOf(organizationId: string, propertyId?: string): Promise<Rows> {
  const tables = [
    ...DELETED_TABLES.filter(({ property }) => property || !propertyId).map(
      ({ table }) => table,
    ),
    ...KEPT_TABLES,
  ]
  const rows: Record<string, unknown[]> = {}
  for (const table of tables) {
    const scoped =
      table === 'properties' && propertyId
        ? `t.organization_id = $1 AND t.id::text = $2`
        : table === 'audit_logs' && propertyId
          ? `t.organization_id = $1 AND t.details->>'propertyId' = $2`
          : where(table, propertyId)
    const result = await query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
       FROM ${table} t WHERE ${scoped}`,
      propertyId ? [organizationId, propertyId] : [organizationId],
    )
    rows[table] = result.rows[0]?.rows as unknown[]
  }
  return rows
}

/** The deleted tables that still hold rows of the scope. */
function leftOver(rows: Rows): string[] {
  return DELETED_TABLES.map(({ table }) => table).filter(
    (table) => (rows[table]?.length ?? 0) > 0,
  )
}

type Write = Readonly<{ entry: BackupErasureLedgerEntry; stillThere: number | null }>

/**
 * The private bucket as the journal sees it: an object, once written, keeps its
 * bytes. Each write records how many of the context's rows were still there.
 */
function bucket() {
  const objects = new Map<string, string>()
  const writes: Write[] = []
  let failing: string | null = null
  const store: RightsJournalStore = {
    async put(key, bytes) {
      const entry = decodeErasureJournalEntry(bytes)
      if (entry.context === failing) {
        failing = null
        throw new Error('bucket unavailable')
      }
      const stored = objects.get(key)
      if (stored !== undefined && stored !== bytes)
        throw new Error('journal object changed')
      objects.set(key, bytes)
      writes.push({ entry, stillThere: await stillThere(entry) })
    },
    alert: () => {},
  }
  return { store, objects, writes, failOnce: (context: string) => (failing = context) }
}

async function stillThere(entry: BackupErasureLedgerEntry): Promise<number | null> {
  const count = STILL_THERE[entry.context]
  if (!count) return null
  const result = await query(
    count(entry.propertyId),
    entry.propertyId ? [entry.organizationId, entry.propertyId] : [entry.organizationId],
  )
  return Number(result.rows[0]?.n)
}

async function run(
  scope: 'property' | 'organization',
  organizationId: string,
  store: RightsJournalStore,
  deleteObject: (key: string) => Promise<void>,
  propertyId?: string,
) {
  const out: string[] = []
  const err: string[] = []
  const journal = createRightsJournal(store)
  const port = createNotificationRightsPort(db, { writeDirect: async () => 'applied' })
  const code = await runRightsExecutors({
    plan: rightsPlan(scope, organizationId, propertyId ? { propertyId } : {}),
    executors: composeRightsExecutors(
      {
        db,
        journal,
        runNotification: (notification) => runNotificationRights(port, notification),
        portalObjectStore: { deleteObject },
        auditPseudonymSecret: SECRET,
      },
      false,
    ),
    journal,
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    subjectRefusal: (plan) => rightsSubjectRefusal(db, plan),
    writeExportFile: async () => {},
    audit: {
      operatorId: 'ops:rights-tester',
      write: async (event) => {
        await writeAuditEvent(db, event)
      },
    },
  })
  return { code, out, err }
}

/** Puts the deleted rows back, parents first, as a restore to before the erasure would. */
async function restore(before: Rows): Promise<void> {
  for (const { table } of DELETED_TABLES) {
    const rows = before[table]
    if (!rows || rows.length === 0) continue
    await query(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(rows)],
    )
  }
}

/** Replays the entries listed in reverse, recording the order the contexts re-erase in. */
async function replay(entries: readonly BackupErasureLedgerEntry[]) {
  const order: string[] = []
  const replayers: BackupErasureReplayer[] = composeRightsReplayers({
    db,
    auditPseudonymSecret: SECRET,
    notificationReplayers: createNotificationRightsReplayers(),
  }).map((replayer) => ({
    ...replayer,
    reErase: (tx, entry) => {
      order.push(entry.context)
      return replayer.reErase(tx, entry)
    },
  }))
  const fence = await db.transaction((tx) =>
    applyRestoreResurrectionFence(tx, {
      entries: [...entries].reverse(),
      restorePointAt: RESTORE_POINT,
      replayers,
    }),
  )
  return { fence, order }
}

/**
 * Each context journaled once, in executor order, with its rows still there.
 * `whole` is false for the tail of a rerun, which starts part way.
 */
function expectJournaledBeforeErasure(writes: readonly Write[], whole = true): void {
  const planIds = new Set(writes.map(({ entry }) => entry.applyOrder?.planId))
  expect(planIds.size).toBe(1)
  const positions = writes.map(({ entry }) => entry.applyOrder?.position ?? -1)
  expect(positions).toEqual([...positions].sort((x, y) => x - y))
  if (whole) {
    expect(positions).toEqual(writes.map((_, index) => index))
    expect(writes.map(({ entry }) => entry.context)).toEqual(
      expect.arrayContaining(Object.keys(STILL_THERE)),
    )
  }
  for (const { entry, stillThere } of writes) {
    if (stillThere !== null) expect(stillThere, entry.context).toBeGreaterThan(0)
  }
}

describe('composed rights request run', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
  })

  afterAll(async () => lease.release())

  afterEach(async () => {
    vi.unstubAllEnvs()
    resetEnv()
    const deleted = [...DELETED_TABLES].reverse()
    await withLastOwnerGuardDisabled(lease.pool, async (client) => {
      for (const organizationId of organizations) {
        for (const { table } of deleted) {
          await client.query(`DELETE FROM ${table} t WHERE ${where(table)}`, [
            organizationId,
          ])
        }
        for (const table of ['audit_events', 'audit_logs', 'properties']) {
          await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
            organizationId,
          ])
        }
      }
    })
    await deleteTestOrganizations(lease.pool, organizations)
    await query('DELETE FROM "user" WHERE id = ANY($1::text[])', [users])
    organizations.length = 0
    users.length = 0
  })

  it('erases Property A, journaling each context before its rows go, and replays it in apply order after a restore', async () => {
    const target = await seedOrganization(2)
    const other = await seedOrganization(1)
    const [a, b] = target.propertyIds as [string, string]
    const aBefore = await rowsOf(target.organizationId, a)
    const bBefore = await rowsOf(target.organizationId, b)
    const otherBefore = await rowsOf(other.organizationId)
    const organizationRows = async () => {
      const rows = await rowsOf(target.organizationId)
      return {
        staff: rows.staff_participants,
        member: rows.member,
        invitation: rows.invitation,
      }
    }
    const organizationBefore = await organizationRows()
    expect(leftOver(aBefore)).toHaveLength(
      DELETED_TABLES.filter((t) => t.property).length,
    )
    const journal = bucket()
    const deleted: string[] = []

    const result = await run(
      'property',
      target.organizationId,
      journal.store,
      async (key) => {
        deleted.push(key)
      },
      a,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expectJournaledBeforeErasure(journal.writes)
    const aAfter = await rowsOf(target.organizationId, a)
    expect(leftOver(aAfter)).toEqual([])
    expect(aAfter.properties).toEqual([
      expect.objectContaining({ lifecycle_state: 'purged' }),
    ])
    expect(JSON.stringify([aAfter.audit_events, aAfter.audit_logs])).not.toMatch(
      /rights-run-|203\.0\.113\.9/u,
    )
    expect(aAfter.audit_logs).toHaveLength(aBefore.audit_logs!.length)
    expect(deleted).toEqual(
      (aBefore.portal_media_assets as Array<{ object_key: string }>).map(
        ({ object_key }) => object_key,
      ),
    )
    expect(await rowsOf(target.organizationId, b)).toEqual(bBefore)
    expect(await organizationRows()).toEqual(organizationBefore)
    expect(await rowsOf(other.organizationId)).toEqual(otherBefore)

    await restore(aBefore)
    expect(leftOver(await rowsOf(target.organizationId, a))).not.toEqual([])
    const replayed = await replay(journal.writes.map(({ entry }) => entry))

    expect(replayed.fence.verified).toBe(true)
    expect(replayed.order).toEqual(journal.writes.map(({ entry }) => entry.context))
    expect(leftOver(await rowsOf(target.organizationId, a))).toEqual([])
    expect(await rowsOf(target.organizationId, b)).toEqual(bBefore)
    expect(await rowsOf(other.organizationId)).toEqual(otherBefore)
  })

  it('closes the Organization, journaling each context before its rows go, and replays it in apply order after a restore', async () => {
    const target = await seedOrganization(2)
    const other = await seedOrganization(1)
    holdRightsOrganization(target.organizationId)
    const before = await rowsOf(target.organizationId)
    const otherBefore = await rowsOf(other.organizationId)
    expect(leftOver(before)).toHaveLength(DELETED_TABLES.length)
    const journal = bucket()

    const result = await run(
      'organization',
      target.organizationId,
      journal.store,
      async () => {},
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expectJournaledBeforeErasure(journal.writes)
    expect(journal.writes.map(({ entry }) => entry.context)).toContain('platform')
    const after = await rowsOf(target.organizationId)
    expect(leftOver(after)).toEqual([])
    expect(after.properties).toHaveLength(2)
    expect(JSON.stringify([after.audit_events, after.audit_logs])).not.toMatch(
      /rights-run-|203\.0\.113\.9/u,
    )
    expect(await rowsOf(other.organizationId)).toEqual(otherBefore)

    await restore(before)
    expect(leftOver(await rowsOf(target.organizationId))).toHaveLength(
      DELETED_TABLES.length,
    )
    const replayed = await replay(journal.writes.map(({ entry }) => entry))

    expect(replayed.fence.verified).toBe(true)
    expect(replayed.order).toEqual(journal.writes.map(({ entry }) => entry.context))
    expect(leftOver(await rowsOf(target.organizationId))).toEqual([])
    expect(await rowsOf(other.organizationId)).toEqual(otherBefore)
  })

  it('finishes a closure stopped by a failed journal write on a rerun, with the same journal entries and nothing erased twice', async () => {
    const target = await seedOrganization(2)
    const other = await seedOrganization(1)
    holdRightsOrganization(target.organizationId)
    const otherBefore = await rowsOf(other.organizationId)
    const mediaKeys = (
      (await rowsOf(target.organizationId)).portal_media_assets as Array<{
        object_key: string
      }>
    ).map(({ object_key }) => object_key)
    const journal = bucket()
    const deleted: string[] = []
    const deleteObject = async (key: string) => {
      deleted.push(key)
    }
    journal.failOnce('identity')

    const stopped = await run(
      'organization',
      target.organizationId,
      journal.store,
      deleteObject,
    )

    expect(stopped.code).toBe(1)
    expect(stopped.err.join('\n')).toMatch(
      /identity: Erasure journal write failed.*executors applied before it: google-integration, review, inbox, guest, reporting, staff, portal, ai, activity/u,
    )
    const half = await rowsOf(target.organizationId)
    expect(leftOver(half)).toEqual(['property_access_grant', 'member', 'invitation'])
    expect(deleted.sort()).toEqual([...mediaKeys].sort())
    const firstObjects = new Map(journal.objects)
    const first = journal.writes.map(({ entry }) => entry)

    const rerun = await run(
      'organization',
      target.organizationId,
      journal.store,
      deleteObject,
    )

    expect(rerun.err).toEqual([])
    expect(rerun.code).toBe(0)
    // The rerun writes every entry again, byte for byte (the bucket refuses a
    // changed object), then journals the rest before their rows go.
    for (const [key, bytes] of firstObjects) expect(journal.objects.get(key)).toBe(bytes)
    const again = journal.writes.slice(first.length)
    expect(again.slice(0, first.length).map(({ entry }) => entry)).toEqual(first)
    expectJournaledBeforeErasure(
      again.filter(({ entry }) => !first.some(({ id }) => id === entry.id)),
      false,
    )
    expect(new Set(again.map(({ entry }) => entry.context)).size).toBe(
      journal.objects.size,
    )
    expect(deleted.sort()).toEqual([...mediaKeys].sort())
    const after = await rowsOf(target.organizationId)
    expect(leftOver(after)).toEqual([])
    // The rerun leaves the pseudonyms the first run wrote; only its own record is new.
    const people = (rows: unknown[] | undefined) =>
      (rows ?? []).filter(
        (row) => (row as { source_kind: string }).source_kind !== 'operator_command',
      )
    expect(people(after.audit_events)).toEqual(people(half.audit_events))
    expect(after.audit_logs).toEqual(half.audit_logs)
    expect(await rowsOf(other.organizationId)).toEqual(otherBefore)
  })
})
