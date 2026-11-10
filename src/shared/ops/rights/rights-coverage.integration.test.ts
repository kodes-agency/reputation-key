// Every composed rights executor for one request, against real PostgreSQL:
// an Organization holding Property A and B beside a second Organization. A
// Property request erases A and leaves B and the other Organization
// byte-identical; an Organization request erases the whole Organization and
// leaves the other one byte-identical. A second case checks that each
// executor's declared tables include every table its deletes cascade into.
// Journal-first writes, the resurrect-and-replay through the restore fence and
// the rejected journal put are proved per executor in its own integration
// test, which also covers the access, guest-response and participant scopes.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { composeRightsExecutors } from '#/composition/rights-executors'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  holdRightsOrganization,
  recordingJournalStore,
  rightsPlan,
  RIGHTS_FIXTURE_AT,
  seedRightsOrganization,
  type RightsQuery,
} from '#/shared/db/testing/rights-isolation-fixture'
import {
  createNotificationRightsPort,
  runNotificationRights,
} from '#/contexts/feed/rights/executor.server'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { runRightsExecutors, type RightsExecutor } from './rights-executor'
import { createRightsJournal } from './rights-journal'

const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const DIGEST = 'd'.repeat(64)

/** Rows a request erases or scrubs in place instead of deleting. */
const KEPT_IN_PLACE = new Set(['reviews', 'replies', 'properties', 'user'])

let lease: TestLease
let db: Database
let query: RightsQuery
let userId: string
const organizations: string[] = []

async function seedProperty(organizationId: string, propertyId: string) {
  const reviewId = randomUUID()
  const templateId = randomUUID()
  const revisionId = randomUUID()
  const itemId = randomUUID()
  const at = RIGHTS_FIXTURE_AT
  await query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       reviewer_name, rating, text, language_code, reviewed_at, expires_at,
       content_expires_at, source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest, source_content_state,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/rights', 'Reviewer', 4, 'Text', 'en', $5, $6, $6,
               0, 1, 1, 1, 24, $7, 'active', $5, $5)`,
    [
      reviewId,
      organizationId,
      propertyId,
      `external-${reviewId}`,
      at,
      EXPIRES_AT,
      DIGEST,
    ],
  )
  await query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by, submitted_by,
       approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Reply', 'published', 'internal', $4, $4, $4, 'human', 'published', 1, $5, $5)`,
    [randomUUID(), reviewId, organizationId, userId, at],
  )
  await query(
    `INSERT INTO property_reply_voices (organization_id, property_id, contact, overridden_fields, updated_by)
     VALUES ($1, $2, 'Voice', ARRAY['contact'], $3)`,
    [organizationId, propertyId, userId],
  )
  await query(
    `INSERT INTO reply_templates (id, organization_id, property_id, builtin_key, created_by, updated_by)
     VALUES ($1, $2, $3, 'P-GEN', $4, $4)`,
    [templateId, organizationId, propertyId, userId],
  )
  await query(
    `INSERT INTO reply_template_revisions (id, template_id, number, title, stars_min, stars_max, review_kind, created_by)
     VALUES ($1, $2, 1, 'Greeting', 4, 5, 'text', $3)`,
    [revisionId, templateId, userId],
  )
  await query(
    `INSERT INTO reply_template_wordings (revision_id, wording_key, language_group, body)
     VALUES ($1, 'one', 'en-Latn', 'Wording')`,
    [revisionId],
  )
  await query(`UPDATE reply_templates SET current_revision_id = $1 WHERE id = $2`, [
    revisionId,
    templateId,
  ])
  await query(
    `INSERT INTO review_sync_state (property_id, next_incremental_at, updated_at)
     VALUES ($1, $2, $2)`,
    [propertyId, EXPIRES_AT],
  )
  await query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status, rating,
       snippet, reviewer_name, source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', 2, 'Snippet', 'Guest', $5, 'portal', 1, $5, $5)`,
    [itemId, organizationId, propertyId, randomUUID(), at],
  )
  await query(
    `INSERT INTO inbox_notes (id, organization_id, inbox_item_id, author_user_id, text, created_at)
     VALUES ($1, $2, $3, $4, 'Note', $5)`,
    [randomUUID(), organizationId, itemId, userId, at],
  )
  await query(
    `INSERT INTO recent_activity_entries
       (actor_id, actor_name, actor_role, action, resource_type, resource_id,
        property_id, organization_id, event_id)
     VALUES ('user:a', 'Actor', 'admin', 'created', 'review', $3, $2, $1, $3)`,
    [organizationId, propertyId, `event-${propertyId}`],
  )
}

async function seedOrganization(properties: number) {
  const seeded = await seedRightsOrganization(query, properties, seedProperty)
  organizations.push(seeded.organizationId)
  await query(
    `INSERT INTO organization_reply_voices (organization_id, contact, overridden_fields, updated_by)
     VALUES ($1, 'Voice', ARRAY['contact'], $2)`,
    [seeded.organizationId, userId],
  )
  await query(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', 2880, 1, $2, $3, $3)`,
    [seeded.organizationId, userId, RIGHTS_FIXTURE_AT],
  )
  return seeded
}

function executorsFor(scope: 'property' | 'organization'): RightsExecutor[] {
  const port = createNotificationRightsPort(db, async () => {})
  return composeRightsExecutors(
    {
      db,
      journal: createRightsJournal(undefined),
      runNotification: (run) => runNotificationRights(port, run),
      portalObjectStore: { deleteObject: async () => {} },
    },
    false,
  ).filter((executor) => executor.scopes.includes(scope))
}

/** Every table a covering executor declares for the scope, with its tenant column. */
async function declaredTables(
  executors: RightsExecutor[],
  scope: 'property' | 'organization',
) {
  const names = [
    ...new Set(executors.flatMap((executor) => executor.tables[scope] ?? [])),
  ]
  const result = await query(
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'organization_id' AND table_name = ANY($1::text[])`,
    [names],
  )
  return result.rows.map((row) => row.table_name as string).sort()
}

async function snapshot(tables: string[], organizationId: string, propertyId?: string) {
  const out: Record<string, unknown> = {}
  for (const table of tables) {
    const result = await query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
       FROM ${table} t WHERE t.organization_id = $1`,
      [organizationId],
    )
    const rows = result.rows[0]?.rows as Array<Record<string, unknown>>
    out[table] = propertyId ? rows.filter((row) => row.property_id === propertyId) : rows
  }
  return JSON.stringify(out)
}

async function run(
  scope: 'property' | 'organization',
  organizationId: string,
  propertyId?: string,
) {
  const out: string[] = []
  const err: string[] = []
  const { store } = recordingJournalStore()
  const code = await runRightsExecutors({
    plan: rightsPlan(scope, organizationId, propertyId ? { propertyId } : {}),
    executors: executorsFor(scope),
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  return { code, out, err }
}

describe('composed rights executors', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
    userId = `rights-user-${randomUUID()}`
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Rights Manager', $2, true, $3, $3)`,
      [userId, `${userId}@example.test`, RIGHTS_FIXTURE_AT],
    )
  })

  afterEach(async () => {
    for (const org of organizations) {
      await query(
        `DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1`,
        [org],
      )
      await query(`DELETE FROM inbox_items WHERE organization_id = $1`, [org])
      await query(
        `DELETE FROM reply_template_wordings WHERE revision_id IN (
           SELECT revision.id FROM reply_template_revisions revision
           JOIN reply_templates template ON template.id = revision.template_id
           WHERE template.organization_id = $1)`,
        [org],
      )
      await query(
        `UPDATE reply_templates SET current_revision_id = NULL WHERE organization_id = $1`,
        [org],
      )
      await query(
        `DELETE FROM reply_template_revisions
         WHERE template_id IN (SELECT id FROM reply_templates WHERE organization_id = $1)`,
        [org],
      )
      for (const table of [
        'reply_templates',
        'property_reply_voices',
        'organization_reply_voices',
        'recent_activity_entries',
        'replies',
        'reviews',
      ]) {
        await query(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
      }
      await query(
        `DELETE FROM review_sync_state WHERE property_id IN
           (SELECT id::text FROM properties WHERE organization_id = $1)`,
        [org],
      )
      await query('DELETE FROM properties WHERE organization_id = $1', [org])
    }
    await deleteTestOrganizations(lease.pool, organizations)
    organizations.length = 0
  })

  afterAll(async () => {
    await query('DELETE FROM "user" WHERE id = $1', [userId])
    await lease.release()
  })

  it('erases Property A across every executor and leaves B and the other Organization byte-identical', async () => {
    const first = await seedOrganization(2)
    const other = await seedOrganization(1)
    const [a, b] = first.propertyIds as [string, string]
    const tables = await declaredTables(executorsFor('property'), 'property')
    const before = {
      a: await snapshot(tables, first.organizationId, a),
      b: await snapshot(tables, first.organizationId, b),
      other: await snapshot(tables, other.organizationId),
    }
    expect(before.a).not.toBe(await snapshot(tables, first.organizationId, randomUUID()))

    const result = await run('property', first.organizationId, a)

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    const afterA = JSON.parse(await snapshot(tables, first.organizationId, a)) as Record<
      string,
      unknown[]
    >
    const leftInA = Object.entries(afterA)
      .filter(([table, rows]) => rows.length > 0 && !KEPT_IN_PLACE.has(table))
      .map(([table]) => table)
    expect(leftInA).toEqual([])
    expect(await snapshot(tables, first.organizationId, b)).toBe(before.b)
    expect(await snapshot(tables, other.organizationId)).toBe(before.other)
  })

  it('erases the Organization across every executor and leaves the other one byte-identical', async () => {
    const first = await seedOrganization(2)
    const other = await seedOrganization(1)
    await holdRightsOrganization(query, first.organizationId)
    const tables = await declaredTables(executorsFor('organization'), 'organization')
    const otherBefore = await snapshot(tables, other.organizationId)

    const result = await run('organization', first.organizationId)

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    const after = JSON.parse(await snapshot(tables, first.organizationId)) as Record<
      string,
      unknown[]
    >
    const left = Object.entries(after)
      .filter(([table, rows]) => rows.length > 0 && !KEPT_IN_PLACE.has(table))
      .map(([table]) => table)
    expect(left).toEqual(
      ['organization_lifecycle_authority'].filter(
        (table) => table in after && after[table]!.length > 0,
      ),
    )
    expect(await snapshot(tables, other.organizationId)).toBe(otherBefore)
  })

  it.each(['property', 'organization'] as const)(
    'declares every table a %s erasure cascades into',
    async (scope) => {
      const executors = executorsFor(scope)
      const declared = new Set(
        executors.flatMap((executor) => executor.tables[scope] ?? []),
      )
      const edges = await query(
        `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
         FROM pg_constraint c WHERE c.contype = 'f' AND c.confdeltype = 'c'`,
      )
      const children = new Map<string, string[]>()
      for (const row of edges.rows) {
        const parent = (row.parent as string).replaceAll('"', '')
        const child = (row.child as string).replaceAll('"', '')
        children.set(parent, [...(children.get(parent) ?? []), child])
      }
      const missing = new Set<string>()
      const seen = new Set<string>()
      const visit = (table: string) => {
        for (const child of children.get(table) ?? []) {
          if (seen.has(child)) continue
          seen.add(child)
          if (!declared.has(child)) missing.add(`${table} -> ${child}`)
          visit(child)
        }
      }
      for (const table of declared) if (!KEPT_IN_PLACE.has(table)) visit(table)

      expect([...missing].sort()).toEqual([])
    },
  )
})
