// The Review and Inbox rights executors against real PostgreSQL, driven the way
// scripts/ops/rights-request.ts drives them: parse, plan, run the executors.
// Two tenants are seeded so every case proves the other one is untouched.

import { reputationReplyScopeEffects } from '#/composition/reply-scope-effects'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  decodeErasureJournalEntry,
  erasureJournalKey,
} from '#/shared/db/lifecycle/erasure-journal.server'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import { runRightsExecutors } from './rights-executor'
import { createRightsJournal, type RightsJournalStore } from './rights-journal'
import { planRightsRequest, rightsRequestCommandSpec } from './rights-request-command'
import {
  INBOX_RIGHTS_EXPORT_PATH,
  REVIEW_RIGHTS_EXPORT_PATH,
  createInboxRightsExecutor,
  createInboxRightsReplayer,
  createReviewRightsExecutor,
  createReviewRightsReplayer,
} from './review-inbox-rights-executors'

const AT = new Date('2026-08-26T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const NOW = new Date('2026-11-08T12:00:00.000Z')
const DIGEST = 'd'.repeat(64)

const MARKERS = Object.freeze({
  reviewText: 'RIGHTS_GUEST_REVIEW_TEXT',
  reviewerName: 'RIGHTS_GUEST_REVIEWER',
  mirroredReply: 'RIGHTS_PROVIDER_MIRRORED_REPLY',
  snippet: 'RIGHTS_INBOX_SOURCE_SNIPPET',
})

type Fixture = Readonly<{
  organizationId: string
  userId: string
  propertyId: string
  secondPropertyId: string
  reviewId: string
  replyId: string
  authorizedReplyId: string
  itemId: string
  texts: Readonly<{ reply: string; library: string; note: string }>
}>

const fixtures: Fixture[] = []
let lease: TestLease
let db: Database

async function insertReview(
  reviewId: string,
  organizationId: string,
  propertyId: string,
): Promise<void> {
  await lease.pool.query(
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
      organizationId,
      propertyId,
      `external-${reviewId}`,
      MARKERS.reviewerName,
      MARKERS.reviewText,
      AT,
      EXPIRES_AT,
      DIGEST,
    ],
  )
}

async function seed(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `rights-org-${suffix}`,
    userId: `rights-user-${suffix}`,
    propertyId: randomUUID(),
    secondPropertyId: randomUUID(),
    reviewId: randomUUID(),
    replyId: randomUUID(),
    authorizedReplyId: randomUUID(),
    itemId: randomUUID(),
    texts: {
      reply: `MANAGER_REPLY_${suffix}`,
      library: `LIBRARY_BODY_${suffix}`,
      note: `INBOX_NOTE_${suffix}`,
    },
  }
  fixtures.push(fixture)
  const q = lease.pool.query.bind(lease.pool)
  const { organizationId: org, propertyId: property, reviewId: review } = fixture
  const mirrorReviewId = randomUUID()
  const authorizedReviewId = randomUUID()

  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights fixture', $1, $2)`,
    [org, AT],
  )
  await q(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Rights Manager', $2, true, $3, $3)`,
    [fixture.userId, `${suffix}@example.test`, AT],
  )
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at)
     VALUES ($1, $2, 'Rights Property', $3, 'UTC', 0, $4, $4)`,
    [property, org, `rights-${suffix}`, AT],
  )
  const reviewIds = [review, mirrorReviewId, authorizedReviewId]
  for (const reviewId of reviewIds) await insertReview(reviewId, org, property)
  for (const [id, replyReviewId, text, source, state, status] of [
    [fixture.replyId, review, fixture.texts.reply, 'internal', 'published', 'published'],
    [
      randomUUID(),
      mirrorReviewId,
      MARKERS.mirroredReply,
      'google_sync',
      'published',
      'published',
    ],
    [
      fixture.authorizedReplyId,
      authorizedReviewId,
      fixture.texts.reply,
      'internal',
      'authorized',
      'approved',
    ],
  ] as const) {
    await q(
      `INSERT INTO replies (
         id, review_id, organization_id, text, status, source, created_by, submitted_by,
         approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $8, $5, $6, $6, $6, $10, $7, 1, $9, $9)`,
      [
        id,
        replyReviewId,
        org,
        text,
        source,
        source === 'internal' ? fixture.userId : null,
        state,
        status,
        AT,
        source === 'internal' ? 'human' : null,
      ],
    )
  }
  await q(
    `INSERT INTO organization_reply_voices (organization_id, contact, overridden_fields, updated_by)
     VALUES ($1, $2, ARRAY['contact'], $3)`,
    [org, fixture.texts.library, fixture.userId],
  )
  const templateId = randomUUID()
  const revisionId = randomUUID()
  await q(
    `INSERT INTO reply_templates (id, organization_id, property_id, builtin_key, created_by, updated_by)
     VALUES ($1, $2, $3, 'P-GEN', $4, $4)`,
    [templateId, org, property, fixture.userId],
  )
  await q(
    `INSERT INTO reply_template_revisions (id, template_id, number, title, stars_min, stars_max, review_kind, created_by)
     VALUES ($1, $2, 1, 'Greeting', 4, 5, 'text', $3)`,
    [revisionId, templateId, fixture.userId],
  )
  await q(
    `INSERT INTO reply_template_wordings (revision_id, wording_key, language_group, body)
     VALUES ($1, 'one', 'en-Latn', $2)`,
    [revisionId, fixture.texts.library],
  )
  await q(`UPDATE reply_templates SET current_revision_id = $1 WHERE id = $2`, [
    revisionId,
    templateId,
  ])

  await q(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status, rating,
       snippet, reviewer_name, source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', 2, $5, $6, $7, 'portal', 1, $7, $7)`,
    [
      fixture.itemId,
      org,
      property,
      randomUUID(),
      MARKERS.snippet,
      MARKERS.reviewerName,
      AT,
    ],
  )
  await q(
    `INSERT INTO inbox_notes (id, organization_id, inbox_item_id, author_user_id, text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), org, fixture.itemId, fixture.userId, fixture.texts.note, AT],
  )
  await q(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', 2880, 1, $2, $3, $3)`,
    [org, fixture.userId, AT],
  )
  return fixture
}

/** Property B of the same Organization: its own review, reply, voice and inbox item. */
async function seedSecondProperty(fixture: Fixture): Promise<void> {
  const q = lease.pool.query.bind(lease.pool)
  const { organizationId: org, secondPropertyId: property, userId } = fixture
  const reviewId = randomUUID()
  const itemId = randomUUID()
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at)
     VALUES ($1, $2, 'Rights Property B', $3, 'UTC', 0, $4, $4)`,
    [property, org, `rights-b-${property}`, AT],
  )
  await insertReview(reviewId, org, property)
  await q(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by, submitted_by,
       approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'published', 'internal', $5, $5, $5, 'human', 'published', 1, $6, $6)`,
    [randomUUID(), reviewId, org, `PROPERTY_B_REPLY_${property}`, userId, AT],
  )
  await q(
    `INSERT INTO property_reply_voices (organization_id, property_id, contact, overridden_fields, updated_by)
     VALUES ($1, $2, $3, ARRAY['contact'], $4)`,
    [org, property, `PROPERTY_B_VOICE_${property}`, userId],
  )
  await q(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status, rating,
       snippet, reviewer_name, source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', 2, $5, $6, $7, 'portal', 1, $7, $7)`,
    [itemId, org, property, randomUUID(), MARKERS.snippet, MARKERS.reviewerName, AT],
  )
  await q(
    `INSERT INTO inbox_notes (id, organization_id, inbox_item_id, author_user_id, text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), org, itemId, userId, `PROPERTY_B_NOTE_${property}`, AT],
  )
}

async function cleanup(fixture: Fixture): Promise<void> {
  const q = lease.pool.query.bind(lease.pool)
  const org = fixture.organizationId
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
    'replies',
    'reviews',
    'properties',
  ]) {
    await q(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
  }
  await deleteTestOrganizations(lease.pool, [org])
  await q('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

const TENANT_TABLES = [
  'reviews',
  'replies',
  'organization_reply_voices',
  'property_reply_voices',
  'reply_templates',
  'inbox_items',
  'inbox_notes',
  'inbox_response_target_organization_policies',
] as const

/** `omit` names columns a trigger owns, for comparisons across a restore. */
async function snapshot(organizationId: string, omit: string[] = []): Promise<string> {
  const parts: string[] = []
  for (const table of TENANT_TABLES) {
    const result = await lease.pool.query(
      `SELECT (to_jsonb(t.*) - $2::text[])::text AS row FROM ${table} AS t
       WHERE organization_id = $1 ORDER BY (to_jsonb(t.*) - $2::text[])::text`,
      [organizationId, omit],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

async function rowCount(table: string, organizationId: string): Promise<number> {
  const result = await lease.pool.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

function planFor(argv: string[], production: boolean) {
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
  return planRightsRequest(ctx, parsed.args, { production })
}

const quietStore: RightsJournalStore = { put: async () => {}, alert: () => {} }

/** What scripts/ops/rights-request.ts does after the operator harness. */
async function runScript(
  argv: string[],
  options: { production?: boolean; store?: RightsJournalStore } = {},
) {
  const planned = planFor(argv, options.production ?? false)
  const out: string[] = []
  const err: string[] = []
  const files = new Map<string, string>()
  if (!planned.ok) return { exit: 1, out, err: [planned.error], files }
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
    journal: createRightsJournal(options.store ?? quietStore),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async (path, bytes) => {
      files.set(path, Buffer.from(bytes).toString('utf8'))
    },
  })
  return { exit, out, err, files }
}

const apply = (organizationId: string) => [
  'organization',
  '--org',
  organizationId,
  'verified=2026-11-01T10:00:00Z',
  'verification=ticket:123',
  '--reason',
  'closure request',
  '--ticket',
  'T-1',
  `confirm=ERASE ORGANIZATION ${organizationId}`,
  '--apply',
  '--yes',
  'ops:rights-request',
]

/** Columns a database trigger maintains, so a restore cannot reproduce them. */
const TRIGGER_OWNED = ['reply_state_revision']

type Captured = Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>

/** Parents before children, so a restore can insert in this order. */
const RESTORE_TABLES = [
  ['reviews', 'organization_id = $1'],
  ['replies', 'organization_id = $1'],
  ['organization_reply_voices', 'organization_id = $1'],
  ['property_reply_voices', 'organization_id = $1'],
  ['reply_templates', 'organization_id = $1'],
  [
    'reply_template_revisions',
    'template_id IN (SELECT id FROM reply_templates WHERE organization_id = $1)',
  ],
  [
    'reply_template_wordings',
    `revision_id IN (SELECT revision.id FROM reply_template_revisions revision
       JOIN reply_templates template ON template.id = revision.template_id
       WHERE template.organization_id = $1)`,
  ],
  ['inbox_items', 'organization_id = $1'],
  ['inbox_notes', 'organization_id = $1'],
  ['inbox_response_target_organization_policies', 'organization_id = $1'],
] as const

/** The rows a backup of the Organization would hold. */
async function capture(organizationId: string): Promise<Captured> {
  const entries: Array<[string, ReadonlyArray<Record<string, unknown>>]> = []
  for (const [table, where] of RESTORE_TABLES) {
    const result = await lease.pool.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) AS rows FROM ${table} t WHERE ${where}`,
      [organizationId],
    )
    entries.push([table, result.rows[0]?.rows ?? []])
  }
  return Object.fromEntries(entries)
}

/** Puts a captured Organization back the way a restore would: shells out, rows in. */
async function resurrect(organizationId: string, captured: Captured): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of ['replies', 'reviews']) {
      await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
      )
    }
    for (const [table] of RESTORE_TABLES) {
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

/** Both Properties of the Organization: content gone, shells scrubbed, nothing else touched. */
async function expectErased(fixture: Fixture): Promise<void> {
  const org = fixture.organizationId
  for (const table of [
    'inbox_items',
    'inbox_notes',
    'inbox_response_target_organization_policies',
    'organization_reply_voices',
    'property_reply_voices',
    'reply_templates',
  ]) {
    expect(await rowCount(table, org), table).toBe(0)
  }
  const replies = await lease.pool.query(
    `SELECT text, created_by FROM replies WHERE organization_id = $1`,
    [org],
  )
  expect(replies.rows).toHaveLength(4)
  expect(replies.rows.every((row) => row.text === '' && row.created_by === null)).toBe(
    true,
  )
  const reviews = await lease.pool.query(
    `SELECT property_id, text, reviewer_name, source_content_state
     FROM reviews WHERE organization_id = $1`,
    [org],
  )
  expect(reviews.rows).toHaveLength(4)
  expect(
    reviews.rows.every(
      (row) =>
        row.text === null &&
        row.reviewer_name === null &&
        row.source_content_state === 'source_expired',
    ),
  ).toBe(true)
  expect(new Set(reviews.rows.map((row) => row.property_id))).toEqual(
    new Set([fixture.propertyId, fixture.secondPropertyId]),
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

describe.sequential(
  'Review and Inbox rights executors through the rights-request command',
  () => {
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

    it('exports the manager-authored data of the asked-for tenant only', async () => {
      const asked = await seed()
      const other = await seed()

      const result = await runScript([
        'access',
        '--org',
        asked.organizationId,
        'out=/export',
      ])

      expect(result.exit).toBe(0)
      const review = result.files.get(`/export/${REVIEW_RIGHTS_EXPORT_PATH}`) ?? ''
      const inbox = result.files.get(`/export/${INBOX_RIGHTS_EXPORT_PATH}`) ?? ''
      const reviewPayload = JSON.parse(review)
      expect(reviewPayload.replies.map((row: { id: string }) => row.id).sort()).toEqual(
        [asked.replyId, asked.authorizedReplyId].sort(),
      )
      expect(review).toContain(asked.texts.reply)
      expect(review).toContain(asked.texts.library)
      expect(JSON.parse(inbox).notes).toHaveLength(1)
      expect(inbox).toContain(asked.texts.note)
      for (const file of [review, inbox]) {
        for (const marker of Object.values(MARKERS)) expect(file).not.toContain(marker)
        expect(file).not.toContain(other.organizationId)
        expect(file).not.toContain(other.texts.reply)
        expect(file).not.toContain(other.texts.note)
      }
    })

    it('refuses to apply in production and changes nothing', async () => {
      const asked = await seed()
      const before = await snapshot(asked.organizationId)

      const result = await runScript(apply(asked.organizationId), { production: true })

      expect(result.exit).toBe(1)
      expect(await snapshot(asked.organizationId)).toBe(before)
    })

    it('refuses a closure while a reply is out at the provider, rolling back the fence', async () => {
      const asked = await seed()
      const other = await seed()
      await lease.pool.query(
        `UPDATE replies SET publication_state = 'sending', status = 'approved'
       WHERE id = $1`,
        [asked.replyId],
      )
      const before = [
        await snapshot(asked.organizationId),
        await snapshot(other.organizationId),
      ]

      const result = await runScript(apply(asked.organizationId))

      expect(result.exit).toBe(1)
      expect(result.err.join('\n')).toContain('active_reply_publications=')
      expect([
        await snapshot(asked.organizationId),
        await snapshot(other.organizationId),
      ]).toEqual(before)
    })

    it('closes one tenant, leaves the other byte-identical, and converges on replay', async () => {
      const asked = await seed()
      const other = await seed()
      // The sent reply must be settled before closure; the authorized one is fenced.
      await lease.pool.query(
        `UPDATE replies SET publication_state = 'published' WHERE id = $1`,
        [asked.authorizedReplyId],
      )
      const otherBefore = await snapshot(other.organizationId)

      const first = await runScript(apply(asked.organizationId))
      expect(first.exit).toBe(0)

      for (const table of [
        'inbox_items',
        'inbox_notes',
        'inbox_response_target_organization_policies',
        'organization_reply_voices',
        'reply_templates',
      ]) {
        expect(await rowCount(table, asked.organizationId)).toBe(0)
      }
      const replies = await lease.pool.query(
        `SELECT text, created_by FROM replies WHERE organization_id = $1`,
        [asked.organizationId],
      )
      expect(
        replies.rows.every((row) => row.text === '' && row.created_by === null),
      ).toBe(true)
      const reviews = await lease.pool.query(
        `SELECT text, reviewer_name, source_content_state FROM reviews WHERE organization_id = $1`,
        [asked.organizationId],
      )
      expect(reviews.rows).toHaveLength(3)
      expect(
        reviews.rows.every(
          (row) =>
            row.text === null &&
            row.reviewer_name === null &&
            row.source_content_state === 'source_expired',
        ),
      ).toBe(true)
      expect(await snapshot(other.organizationId)).toBe(otherBefore)

      const replay = await runScript(apply(asked.organizationId))
      expect(replay.exit).toBe(0)
      expect(await snapshot(other.organizationId)).toBe(otherBefore)
    })

    describe('one Organization with two Properties beside another Organization', () => {
      // Review and Inbox erase by Organization only (scopes: access, organization),
      // so "apply" closes Organization 1, which holds Properties A and B together.
      // Organization 2 stands in for everything that must stay untouched.
      async function seedPair() {
        const closing = await seed()
        await seedSecondProperty(closing)
        const kept = await seed()
        // The authorized reply is fenced at closure; settle it so closure is not refused.
        await lease.pool.query(
          `UPDATE replies SET publication_state = 'published' WHERE id = $1`,
          [closing.authorizedReplyId],
        )
        return { closing, kept }
      }

      const reportLines = async (organizationId: string) =>
        (await runScript(['access', '--org', organizationId])).out

      it('reports the counts of both Properties and of the other Organization', async () => {
        const { closing, kept } = await seedPair()

        const closingLines = (await reportLines(closing.organizationId)).join('\n')
        const keptLines = (await reportLines(kept.organizationId)).join('\n')

        expect(closingLines).toContain('review: reviews=4 replies=4 ')
        expect(closingLines).toContain(
          'organization_reply_voices=1 property_reply_voices=1 reply_templates=1',
        )
        expect(closingLines).toContain('review: closure blockers: none')
        expect(closingLines).toContain(
          'inbox: inbox_items=2 inbox_handling_cycles=0 inbox_notes=2 inbox_response_target_organization_policies=1',
        )
        expect(keptLines).toContain('review: reviews=3 replies=3 ')
        expect(keptLines).toContain(
          'organization_reply_voices=1 property_reply_voices=0 reply_templates=1',
        )
        expect(keptLines).toContain(
          'inbox: inbox_items=1 inbox_handling_cycles=0 inbox_notes=1',
        )
      })

      it('reports a missing Organization instead of counting', async () => {
        const lines = await reportLines('rights-org-missing')

        expect(lines).toContain('review: organization not found')
        expect(lines).toContain('inbox: organization not found')
      })

      it('erases both Properties together and leaves the other Organization byte-identical', async () => {
        const { closing, kept } = await seedPair()
        const keptBefore = await snapshot(kept.organizationId)

        const result = await runScript(apply(closing.organizationId))

        expect(result.exit).toBe(0)
        await expectErased(closing)
        expect(await snapshot(kept.organizationId)).toBe(keptBefore)
        expect(await rowCount('inbox_items', kept.organizationId)).toBe(1)
      })

      it('erases again when a restore brings both Properties back, through the journal entries', async () => {
        const { closing, kept } = await seedPair()
        const journal = new Map<string, string>()
        const backup = await capture(closing.organizationId)
        const closingBefore = await snapshot(closing.organizationId, TRIGGER_OWNED)
        const keptBefore = await snapshot(kept.organizationId)

        const applied = await runScript(apply(closing.organizationId), {
          store: putInto(journal),
        })
        expect(applied.exit).toBe(0)
        const erased = await snapshot(closing.organizationId, TRIGGER_OWNED)

        await resurrect(closing.organizationId, backup)
        expect(await snapshot(closing.organizationId, TRIGGER_OWNED)).toBe(closingBefore)
        expect(await rowCount('inbox_items', closing.organizationId)).toBe(2)

        const entries = [...journal.entries()].map(([key, bytes]) => {
          const entry = decodeErasureJournalEntry(bytes)
          expect(key).toBe(erasureJournalKey(entry.id))
          return entry
        })
        expect(entries.map((entry) => entry.context).sort()).toEqual(['inbox', 'review'])
        expect(entries.every((entry) => entry.subjectClass === 'organization')).toBe(true)
        const result = await db.transaction((tx) =>
          applyRestoreResurrectionFence(tx, {
            entries,
            restorePointAt: new Date(NOW.getTime() - 60_000),
            replayers: [
              createReviewRightsReplayer({
                db,
                now: () => NOW,
                replyEffects: reputationReplyScopeEffects,
              }),
              createInboxRightsReplayer({ db, now: () => NOW }),
            ],
          }),
        )

        expect(result.verified).toBe(true)
        expect(result.counts.ledgerEntriesReapplied).toBe(2)
        await expectErased(closing)
        expect(await snapshot(closing.organizationId, TRIGGER_OWNED)).toBe(erased)
        expect(await snapshot(kept.organizationId)).toBe(keptBefore)
      })

      it('erases nothing and raises the alarm when the journal write is rejected', async () => {
        const { closing, kept } = await seedPair()
        const before = [
          await snapshot(closing.organizationId),
          await snapshot(kept.organizationId),
        ]
        const alert = vi.fn()

        const result = await runScript(apply(closing.organizationId), {
          store: { put: () => Promise.reject(new Error('bucket down')), alert },
        })

        expect(result.exit).not.toBe(0)
        expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'review' }))
        expect(result.err.join('\n')).toContain('Erasure journal write failed')
        expect([
          await snapshot(closing.organizationId),
          await snapshot(kept.organizationId),
        ]).toEqual(before)
      })

      it('refuses while a snapshot run is open and rolls the fence back', async () => {
        const { closing, kept } = await seedPair()
        await lease.pool.query(
          `INSERT INTO review_provider_snapshot_runs (
             id, organization_id, property_id, source_epoch, state, phase,
             expected_total, expected_average_rating, main_page_count,
             main_unique_count, confirmation_page_count, confirmation_unique_count,
             started_at, confirmation_deadline, expires_at, observation_origin,
             created_at, updated_at
           ) VALUES ($1, $2, $3, 0, 'scanning', 'main', 1, 4, 1, 1, 1, 1,
                     $4::timestamptz, $5::timestamptz, $5::timestamptz, 'ongoing',
                     $4::timestamptz, $4::timestamptz)`,
          [
            randomUUID(),
            closing.organizationId,
            closing.secondPropertyId,
            AT,
            EXPIRES_AT,
          ],
        )
        const before = [
          await snapshot(closing.organizationId),
          await snapshot(kept.organizationId),
        ]

        const result = await runScript(apply(closing.organizationId))

        expect(result.exit).toBe(1)
        expect(result.err.join('\n')).toContain('open_provider_snapshot_runs=1')
        expect(result.err.join('\n')).toContain('nothing was changed')
        expect([
          await snapshot(closing.organizationId),
          await snapshot(kept.organizationId),
        ]).toEqual(before)
        expect(
          await rowCount('review_provider_snapshot_runs', closing.organizationId),
        ).toBe(1)
      })

      it('refuses an Organization Inbox does not know, changing nothing', async () => {
        const { kept } = await seedPair()
        const before = await snapshot(kept.organizationId)
        const planned = planFor(apply('rights-org-missing'), false)
        if (!planned.ok) throw new Error(planned.error)
        const inbox = createInboxRightsExecutor({ db, now: () => NOW })

        expect(await inbox.preflight?.(planned.plan)).toEqual({
          ok: false,
          error: 'organization not found',
        })
        expect(await inbox.apply(planned.plan)).toEqual({
          ok: false,
          error: 'organization not found',
        })
        const result = await runScript(apply('rights-org-missing'))
        expect(result.exit).toBe(1)
        expect(result.err.join('\n')).toContain('organization not found')
        expect(await snapshot(kept.organizationId)).toBe(before)
      })
    })
  },
)
