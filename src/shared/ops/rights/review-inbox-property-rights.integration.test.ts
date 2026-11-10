// The Review and Inbox rights executors for a Property request, against real
// PostgreSQL, driven the way scripts/ops/rights-request.ts drives them. One
// Organization holds Property A and B; a second Organization holds its own two.
// Every case proves that only the asked-for Property changes.

import { reputationReplyScopeEffects } from '#/composition/reply-scope-effects'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { closeInboxInTx } from '#/shared/db/lifecycle/inbox-rights-store'
import { closeReviewInTx } from '#/shared/db/lifecycle/review-rights-store'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import { runRightsExecutors } from './rights-executor'
import { createRightsJournal, type RightsJournalStore } from './rights-journal'
import { planRightsRequest, rightsRequestCommandSpec } from './rights-request-command'
import {
  createInboxRightsExecutor,
  createReviewRightsExecutor,
} from './review-inbox-rights-executors'

const AT = new Date('2026-08-26T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const NOW = new Date('2026-11-08T12:00:00.000Z')
const DIGEST = 'd'.repeat(64)

type Tenant = Readonly<{
  organizationId: string
  userId: string
  propertyA: string
  propertyB: string
}>

const tenants: Tenant[] = []
let lease: TestLease
let db: Database

async function seedProperty(
  tenant: Tenant,
  propertyId: string,
  label: string,
): Promise<void> {
  const q = lease.pool.query.bind(lease.pool)
  const org = tenant.organizationId
  const reviewId = randomUUID()
  const templateId = randomUUID()
  const revisionId = randomUUID()
  const itemId = randomUUID()
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'UTC', 0, $5, $5)`,
    [propertyId, org, `Property ${label}`, `rights-${propertyId}`, AT],
  )
  await q(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       reviewer_name, rating, text, language_code, reviewed_at, expires_at,
       content_expires_at, source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest, source_content_state,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/rights', $5, 4, $6, 'en', $7, $8, $8,
               0, 1, 1, 1, 24, $9, 'active', $7, $7)`,
    [
      reviewId,
      org,
      propertyId,
      `external-${reviewId}`,
      `REVIEWER_${label}`,
      `REVIEW_TEXT_${label}`,
      AT,
      EXPIRES_AT,
      DIGEST,
    ],
  )
  await q(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by, submitted_by,
       approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'published', 'internal', $5, $5, $5, 'human', 'published', 1, $6, $6)`,
    [randomUUID(), reviewId, org, `REPLY_${label}`, tenant.userId, AT],
  )
  await q(
    `INSERT INTO property_reply_voices (organization_id, property_id, contact, overridden_fields, updated_by)
     VALUES ($1, $2, $3, ARRAY['contact'], $4)`,
    [org, propertyId, `VOICE_${label}`, tenant.userId],
  )
  await q(
    `INSERT INTO reply_templates (id, organization_id, property_id, builtin_key, created_by, updated_by)
     VALUES ($1, $2, $3, 'P-GEN', $4, $4)`,
    [templateId, org, propertyId, tenant.userId],
  )
  await q(
    `INSERT INTO reply_template_revisions (id, template_id, number, title, stars_min, stars_max, review_kind, created_by)
     VALUES ($1, $2, 1, 'Greeting', 4, 5, 'text', $3)`,
    [revisionId, templateId, tenant.userId],
  )
  await q(
    `INSERT INTO reply_template_wordings (revision_id, wording_key, language_group, body)
     VALUES ($1, 'one', 'en-Latn', $2)`,
    [revisionId, `WORDING_${label}`],
  )
  await q(`UPDATE reply_templates SET current_revision_id = $1 WHERE id = $2`, [
    revisionId,
    templateId,
  ])
  await q(
    `INSERT INTO review_sync_state (property_id, next_incremental_at, updated_at)
     VALUES ($1, $2, $2)`,
    [propertyId, EXPIRES_AT],
  )
  await q(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status, rating,
       snippet, reviewer_name, source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', 2, $5, $6, $7, 'portal', 1, $7, $7)`,
    [itemId, org, propertyId, randomUUID(), `SNIPPET_${label}`, `GUEST_${label}`, AT],
  )
  await q(
    `INSERT INTO inbox_notes (id, organization_id, inbox_item_id, author_user_id, text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), org, itemId, tenant.userId, `NOTE_${label}`, AT],
  )
  await q(
    `INSERT INTO inbox_private_feedback_target_property_overrides (
       organization_id, property_id, enabled, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, $2, true, 1440, 1, $3, $4, $4)`,
    [org, propertyId, tenant.userId, AT],
  )
}

async function seedTenant(): Promise<Tenant> {
  const suffix = randomUUID()
  const tenant: Tenant = {
    organizationId: `rights-org-${suffix}`,
    userId: `rights-user-${suffix}`,
    propertyA: randomUUID(),
    propertyB: randomUUID(),
  }
  tenants.push(tenant)
  const q = lease.pool.query.bind(lease.pool)
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights fixture', $1, $2)`,
    [tenant.organizationId, AT],
  )
  await q(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Rights Manager', $2, true, $3, $3)`,
    [tenant.userId, `${suffix}@example.test`, AT],
  )
  await q(
    `INSERT INTO organization_reply_voices (organization_id, contact, overridden_fields, updated_by)
     VALUES ($1, 'ORGANIZATION_VOICE', ARRAY['contact'], $2)`,
    [tenant.organizationId, tenant.userId],
  )
  await q(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', 2880, 1, $2, $3, $3)`,
    [tenant.organizationId, tenant.userId, AT],
  )
  await seedProperty(tenant, tenant.propertyA, `A_${suffix}`)
  await seedProperty(tenant, tenant.propertyB, `B_${suffix}`)
  return tenant
}

async function cleanup(tenant: Tenant): Promise<void> {
  const q = lease.pool.query.bind(lease.pool)
  const org = tenant.organizationId
  const properties = [tenant.propertyA, tenant.propertyB]
  await q(
    `DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1`,
    [org],
  )
  await q(`DELETE FROM inbox_items WHERE organization_id = $1`, [org])
  await q(`DELETE FROM reply_template_visibility WHERE organization_id = $1`, [org])
  await q(
    `DELETE FROM reply_template_wordings WHERE revision_id IN (
       SELECT revision.id FROM reply_template_revisions revision
       JOIN reply_templates template ON template.id = revision.template_id
       WHERE template.organization_id = $1)`,
    [org],
  )
  await q(
    `UPDATE reply_templates SET current_revision_id = NULL WHERE organization_id = $1`,
    [org],
  )
  await q(
    `DELETE FROM reply_template_revisions
     WHERE template_id IN (SELECT id FROM reply_templates WHERE organization_id = $1)`,
    [org],
  )
  for (const table of [
    'reply_templates',
    'property_reply_voices',
    'organization_reply_voices',
    'inbox_private_feedback_target_property_overrides',
    'replies',
    'reviews',
  ]) {
    await q(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
  }
  await q(`DELETE FROM review_sync_state WHERE property_id = ANY($1::text[])`, [
    properties,
  ])
  await q(`DELETE FROM properties WHERE organization_id = $1`, [org])
  await deleteTestOrganizations(lease.pool, [org])
  await q('DELETE FROM "user" WHERE id = $1', [tenant.userId])
}

/** Every table the two executors touch, with the SQL that picks a Property's rows. */
const TABLES: ReadonlyArray<Readonly<{ table: string; inProperty: string }>> = [
  { table: 'reviews', inProperty: 't.property_id = $1' },
  {
    table: 'replies',
    inProperty: 't.review_id IN (SELECT id FROM reviews WHERE property_id = $1)',
  },
  { table: 'property_reply_voices', inProperty: 't.property_id = $1' },
  { table: 'reply_templates', inProperty: 't.property_id = $1' },
  {
    table: 'reply_template_revisions',
    inProperty:
      't.template_id IN (SELECT id FROM reply_templates WHERE property_id = $1)',
  },
  {
    table: 'reply_template_wordings',
    inProperty: `t.revision_id IN (SELECT revision.id FROM reply_template_revisions revision
      JOIN reply_templates template ON template.id = revision.template_id
      WHERE template.property_id = $1)`,
  },
  { table: 'review_sync_state', inProperty: 't.property_id = $1' },
  { table: 'inbox_items', inProperty: 't.property_id = $1' },
  {
    table: 'inbox_notes',
    inProperty: 't.inbox_item_id IN (SELECT id FROM inbox_items WHERE property_id = $1)',
  },
  {
    table: 'inbox_private_feedback_target_property_overrides',
    inProperty: 't.property_id = $1',
  },
]

/** Organization-level rows a Property request must leave alone. */
const ORGANIZATION_LEVEL = [
  'organization_reply_voices',
  'inbox_response_target_organization_policies',
] as const

/** Columns a database trigger maintains, so a restore cannot reproduce them. */
const TRIGGER_OWNED = ['reply_state_revision']

/** One Property's rows in every table the executors touch. */
async function propertySnapshot(
  propertyId: string,
  omit: string[] = [],
): Promise<string> {
  const parts: string[] = []
  for (const { table, inProperty } of TABLES) {
    const result = await lease.pool.query(
      `SELECT (to_jsonb(t.*) - $2::text[])::text AS row FROM ${table} AS t
       WHERE ${inProperty}
       ORDER BY (to_jsonb(t.*) - $2::text[])::text`,
      [propertyId, omit],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

/** Both Properties and the Organization-level rows. */
async function snapshot(tenant: Tenant): Promise<string> {
  const parts = [
    await propertySnapshot(tenant.propertyA),
    await propertySnapshot(tenant.propertyB),
  ]
  for (const table of ORGANIZATION_LEVEL) {
    const result = await lease.pool.query(
      `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
       WHERE organization_id = $1 ORDER BY 1`,
      [tenant.organizationId],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

async function rowCount(
  table: string,
  where: string,
  params: unknown[],
): Promise<number> {
  const result = await lease.pool.query(
    `SELECT count(*)::int AS count FROM ${table} t WHERE ${where}`,
    params,
  )
  return Number(result.rows[0]?.count ?? 0)
}

type Captured = Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>

/** The rows a backup would hold for one Property, parents before children. */
async function capture(propertyId: string): Promise<Captured> {
  const entries: Array<[string, ReadonlyArray<Record<string, unknown>>]> = []
  for (const { table, inProperty } of TABLES) {
    const result = await lease.pool.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) AS rows FROM ${table} t
       WHERE ${inProperty}`,
      [propertyId],
    )
    entries.push([table, result.rows[0]?.rows ?? []])
  }
  return Object.fromEntries(entries)
}

/** Puts a captured Property back the way a restore would: shells out, rows in. */
async function resurrect(captured: Captured): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of ['replies', 'reviews']) {
      const ids = (captured[table] ?? []).map((row) => String(row.id))
      await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)}
            WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`,
      )
    }
    for (const { table } of TABLES) {
      const rows = captured[table] ?? []
      if (rows.length === 0) continue
      // Templates and revisions point at each other: link them after both exist.
      const insert =
        table === 'reply_templates'
          ? rows.map((row) => ({ ...row, current_revision_id: null }))
          : rows
      await tx.execute(
        sql`INSERT INTO ${sql.identifier(table)}
            SELECT * FROM jsonb_populate_recordset(NULL::${sql.identifier(table)}, ${JSON.stringify(insert)}::jsonb)`,
      )
    }
    await tx.execute(
      sql`UPDATE reply_templates AS template SET current_revision_id = restored.current_revision_id
          FROM jsonb_populate_recordset(NULL::reply_templates, ${JSON.stringify(captured.reply_templates ?? [])}::jsonb) AS restored
          WHERE template.id = restored.id`,
    )
  })
}

function planFor(argv: string[]) {
  const parsed = parseOperatorArgs(
    ['--operator', 'op', ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) return parsed
  const ctx = {
    organizationId: parsed.args.organizationId,
    propertyId: parsed.args.propertyId,
    dryRun: !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  return planRightsRequest(ctx, parsed.args, { production: false })
}

const quietStore: RightsJournalStore = { put: async () => {}, alert: () => {} }

async function runScript(argv: string[], store: RightsJournalStore = quietStore) {
  const planned = planFor(argv)
  const out: string[] = []
  const err: string[] = []
  if (!planned.ok) return { exit: 1, out, err: [planned.error] }
  const exit = await runRightsExecutors({
    plan: planned.plan,
    executors: [
      createReviewRightsExecutor({
        db,
        now: () => NOW,
        replyEffects: reputationReplyScopeEffects,
      }),
      createInboxRightsExecutor({ db, now: () => NOW }),
    ],
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  return { exit, out, err }
}

const report = (organizationId: string, propertyId: string) => [
  'property',
  '--org',
  organizationId,
  '--property',
  propertyId,
]

const apply = (organizationId: string, propertyId: string) => [
  ...report(organizationId, propertyId),
  'verified=2026-11-01T10:00:00Z',
  'verification=ticket:123',
  '--reason',
  'erasure request',
  '--ticket',
  'T-1',
  `confirm=ERASE PROPERTY ${propertyId}`,
  '--apply',
  '--yes',
  'ops:rights-request',
]

/** Property A has lost its content and its Review and Inbox rows. */
async function expectErased(tenant: Tenant): Promise<void> {
  const org = tenant.organizationId
  const a = tenant.propertyA
  for (const table of [
    'property_reply_voices',
    'reply_templates',
    'review_sync_state',
    'inbox_items',
    'inbox_private_feedback_target_property_overrides',
  ]) {
    expect(await rowCount(table, 't.property_id = $1', [a]), table).toBe(0)
  }
  expect(
    await rowCount(
      'inbox_notes',
      't.organization_id = $1 AND t.inbox_item_id IN (SELECT id FROM inbox_items WHERE property_id = $2)',
      [org, a],
    ),
  ).toBe(0)
  const reviews = await lease.pool.query(
    `SELECT text, reviewer_name, source_content_state FROM reviews
     WHERE organization_id = $1 AND property_id = $2`,
    [org, a],
  )
  expect(reviews.rows).toHaveLength(1)
  expect(
    reviews.rows.every(
      (row) =>
        row.text === null &&
        row.reviewer_name === null &&
        row.source_content_state === 'source_expired',
    ),
  ).toBe(true)
  const replies = await lease.pool.query(
    `SELECT text, created_by FROM replies
     WHERE organization_id = $1
       AND review_id IN (SELECT id FROM reviews WHERE property_id = $2)`,
    [org, a],
  )
  expect(replies.rows).toHaveLength(1)
  expect(replies.rows.every((row) => row.text === '' && row.created_by === null)).toBe(
    true,
  )
}

function putInto(journal: Map<string, string>): RightsJournalStore {
  return {
    put: async (key, bytes) => {
      journal.set(key, bytes)
    },
    alert: () => {},
  }
}

describe.sequential('Review and Inbox rights executors for a Property request', () => {
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

  it('reports the counts of each Property without changing anything', async () => {
    const asked = await seedTenant()
    const other = await seedTenant()
    const before = [await snapshot(asked), await snapshot(other)]

    for (const tenant of [asked, other]) {
      for (const propertyId of [tenant.propertyA, tenant.propertyB]) {
        const result = await runScript(report(tenant.organizationId, propertyId))
        expect(result.exit).toBe(0)
        expect(result.out).toContain(
          'review: reviews=1 replies=1 review_provider_snapshot_runs=0 review_provider_history_cutoffs=0 review_ai_analysis_heads=0 review_google_reputation_snapshot_facts=0 property_reply_voices=1 reply_templates=1 reply_template_visibility=0 reply_template_revisions=1 reply_template_wordings=1 reply_publication_attempts=0 material_review_revisions=0 review_source_contents=0 review_source_observations=0 review_first_sightings=0 review_provider_subjects=0 review_ai_analysis_released_sequences=0 google_reply_observations=0 google_reply_observation_heads=0 review_provider_snapshot_members=0 review_provider_deletion_candidates=0 review_sync_runs=0 review_sync_state=1 idempotency_receipts=0',
        )
        expect(result.out).toContain(
          'inbox: inbox_items=1 inbox_handling_cycles=0 inbox_notes=1 inbox_private_feedback_target_property_overrides=1 inbox_assignment_history=0 inbox_escalation_history=0 inbox_priority_history=0 inbox_handling_cycle_heads=0 inbox_handling_cycle_transitions=0 inbox_handling_cycle_response_targets=0 inbox_response_target_reminders=0 inbox_response_target_exclusions=0 inbox_feedback_handling_outcomes=0',
        )
      }
    }
    expect([await snapshot(asked), await snapshot(other)]).toEqual(before)
  })

  it('erases A, leaves B and the other Organization byte-identical, and replays a restore', async () => {
    const asked = await seedTenant()
    const other = await seedTenant()
    const a = asked.propertyA
    const bBefore = await propertySnapshot(asked.propertyB)
    const organizationLevel = await rowCount(
      'organization_reply_voices',
      't.organization_id = $1',
      [asked.organizationId],
    )
    const otherBefore = await snapshot(other)
    const aBefore = await propertySnapshot(a, TRIGGER_OWNED)
    const backup = await capture(a)
    const journal = new Map<string, string>()

    const applied = await runScript(apply(asked.organizationId, a), putInto(journal))

    expect(applied.exit).toBe(0)
    await expectErased(asked)
    expect(await propertySnapshot(asked.propertyB)).toBe(bBefore)
    expect(await snapshot(other)).toBe(otherBefore)
    expect(
      await rowCount('organization_reply_voices', 't.organization_id = $1', [
        asked.organizationId,
      ]),
    ).toBe(organizationLevel)
    expect(
      await rowCount(
        'inbox_response_target_organization_policies',
        't.organization_id = $1',
        [asked.organizationId],
      ),
    ).toBe(1)
    const erased = await propertySnapshot(a, TRIGGER_OWNED)

    await resurrect(backup)
    expect(await propertySnapshot(a, TRIGGER_OWNED)).toBe(aBefore)

    const entries = [...journal.values()].map(decodeErasureJournalEntry)
    expect(entries.map((entry) => entry.context).sort()).toEqual(['inbox', 'review'])
    expect(
      entries.every(
        (entry) => entry.subjectClass === 'property' && entry.propertyId === a,
      ),
    ).toBe(true)
    const fence = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries,
        restorePointAt: new Date(NOW.getTime() - 60_000),
        replayers: [
          {
            context: 'review',
            subjectClass: 'property',
            reErase: async (tx, entry) => {
              const outcome = await closeReviewInTx(
                tx,
                reputationReplyScopeEffects,
                { organizationId: entry.organizationId, propertyId: entry.propertyId },
                NOW,
              )
              if (!outcome.ok) throw new Error(outcome.error)
              return outcome.deleted + outcome.scrubbed
            },
          },
          {
            context: 'inbox',
            subjectClass: 'property',
            reErase: async (tx, entry) => {
              const outcome = await closeInboxInTx(
                tx,
                { organizationId: entry.organizationId, propertyId: entry.propertyId },
                NOW,
              )
              if (!outcome.ok) throw new Error(outcome.error)
              return outcome.deleted
            },
          },
        ],
      }),
    )

    expect(fence.verified).toBe(true)
    expect(fence.counts.ledgerEntriesReapplied).toBe(2)
    await expectErased(asked)
    expect(await propertySnapshot(a, TRIGGER_OWNED)).toBe(erased)
    expect(await propertySnapshot(asked.propertyB)).toBe(bBefore)
    expect(await snapshot(other)).toBe(otherBefore)
  })

  it('erases nothing and raises the alarm when the journal write is rejected', async () => {
    const asked = await seedTenant()
    const other = await seedTenant()
    const before = [await snapshot(asked), await snapshot(other)]
    const alert = vi.fn()

    const result = await runScript(apply(asked.organizationId, asked.propertyA), {
      put: () => Promise.reject(new Error('bucket down')),
      alert,
    })

    expect(result.exit).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'review' }))
    expect(result.err.join('\n')).toContain('Erasure journal write failed')
    expect([await snapshot(asked), await snapshot(other)]).toEqual(before)
  })

  it('refuses a Property that is not in the Organization and changes nothing', async () => {
    const asked = await seedTenant()
    const other = await seedTenant()
    const before = [await snapshot(asked), await snapshot(other)]

    const result = await runScript(apply(asked.organizationId, other.propertyA))

    expect(result.exit).not.toBe(0)
    expect(result.err.join('\n')).toContain('property not found')
    expect([await snapshot(asked), await snapshot(other)]).toEqual(before)
  })
})
