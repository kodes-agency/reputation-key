// The Review and Inbox rights executors against real PostgreSQL, driven the way
// scripts/ops/rights-request.ts drives them: parse, plan, run the executors.
// Two tenants are seeded so every case proves the other one is untouched.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import { runRightsExecutors } from './rights-executor'
import { planRightsRequest, rightsRequestCommandSpec } from './rights-request-command'
import {
  INBOX_RIGHTS_EXPORT_PATH,
  REVIEW_RIGHTS_EXPORT_PATH,
  createInboxRightsExecutor,
  createReviewRightsExecutor,
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
  reviewId: string
  replyId: string
  authorizedReplyId: string
  itemId: string
  texts: Readonly<{ reply: string; library: string; note: string }>
}>

const fixtures: Fixture[] = []
let lease: TestLease
let db: Database

async function seed(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `rights-org-${suffix}`,
    userId: `rights-user-${suffix}`,
    propertyId: randomUUID(),
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
  for (const reviewId of reviewIds) {
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
        property,
        `external-${reviewId}`,
        MARKERS.reviewerName,
        MARKERS.reviewText,
        AT,
        EXPIRES_AT,
        DIGEST,
      ],
    )
  }
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
  'reply_templates',
  'inbox_items',
  'inbox_notes',
  'inbox_response_target_organization_policies',
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
async function runScript(argv: string[], options: { production?: boolean } = {}) {
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
    executors: [
      createReviewRightsExecutor({ db, now: () => NOW }),
      createInboxRightsExecutor({ db, now: () => NOW }),
    ],
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
  },
)
