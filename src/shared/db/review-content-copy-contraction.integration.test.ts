import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0131_drop_review_provider_content_copy'
const VALIDATION = '0132_validate_review_source_content_state'
const CHECK = 'reviews_source_content_state_valid'
const DROPPED_COLUMNS = [
  'reviewer_name',
  'reviewer_profile_photo_url',
  'google_review_url',
  'rating',
  'text',
  'translated_text',
  'language_code',
  'reviewed_at',
  'source_created_at',
  'source_updated_at',
  'last_fetched_at',
  'content_expires_at',
  'content_hash',
  'ai_source_byte_length',
  'ai_source_digest',
] as const
const DROPPED_CHECKS = [
  'reviews_ai_source_byte_length_valid',
  'reviews_ai_source_digest_valid',
]
const DROPPED_INDEXES = [
  'reviews_content_expires_idx',
  'reviews_org_property_reviewed_idx',
  'reviews_property_created_cursor_idx',
  'reviews_property_updated_cursor_idx',
]

it(
  'refuses to drop the Review content copy while a live Review has no content row, then drops only the copy and keeps the strict tombstone shape',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, entries, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        expect(entries.findIndex(({ tag }) => tag === VALIDATION)).toBe(
          migrationIndex + 1,
        )
        await migrateThrough(migrationIndex)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

        const dropped = DROPPED_COLUMNS.map((column) => `- '${column}'`).join(' ')
        const retainedReviews = async () =>
          (
            await client.query(
              `SELECT to_jsonb(review) ${dropped} AS row FROM reviews review ORDER BY id`,
            )
          ).rows
        const contentRows = async () =>
          (await client.query('SELECT * FROM review_source_contents ORDER BY review_id'))
            .rows
        const columns = async () =>
          (
            await client.query<{ column_name: string }>(
              `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'reviews'
           ORDER BY ordinal_position`,
            )
          ).rows
        const constraints = async () =>
          (
            await client.query<{ conname: string; convalidated: boolean }>(
              `SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass
           ORDER BY conname`,
            )
          ).rows
        const indexes = async () =>
          (
            await client.query<{ indexname: string }>(
              `SELECT indexname FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'reviews' ORDER BY indexname`,
            )
          ).rows.map(({ indexname }) => indexname)
        const journal = async () =>
          (
            await client.query(
              'SELECT hash, created_at, is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
            )
          ).rows

        const reviewCount = (await retainedReviews()).length
        expect(reviewCount).toBeGreaterThan(0)
        const beforeRows = await retainedReviews()
        const beforeContent = await contentRows()
        const beforeColumns = await columns()
        const beforeConstraints = await constraints()
        const beforeIndexes = await indexes()
        const beforeJournal = await journal()
        for (const column of DROPPED_COLUMNS) {
          expect(beforeColumns.map(({ column_name }) => column_name)).toContain(column)
        }

        const orphan = (
          await client.query<{ review_id: string; content: unknown }>(
            `SELECT c.review_id, to_jsonb(c) AS content
         FROM review_source_contents c
         JOIN reviews r ON r.id = c.review_id AND r.source_content_state = 'active'
         ORDER BY c.review_id LIMIT 1`,
          )
        ).rows[0]
        expect(orphan).toBeDefined()
        await client.query('DELETE FROM review_source_contents WHERE review_id = $1', [
          orphan!.review_id,
        ])
        await expect(migrateThrough(migrationIndex + 1)).rejects.toThrow(
          /1 active Reviews have no review_source_contents row/,
        )
        expect(await retainedReviews()).toEqual(beforeRows)
        expect(await columns()).toEqual(beforeColumns)
        expect(await constraints()).toEqual(beforeConstraints)
        expect(await indexes()).toEqual(beforeIndexes)
        expect(await journal()).toEqual(beforeJournal)
        await client.query(
          `INSERT INTO review_source_contents
       SELECT * FROM jsonb_populate_record(NULL::review_source_contents, $1::jsonb)`,
          [JSON.stringify(orphan!.content)],
        )
        expect(await contentRows()).toEqual(beforeContent)

        await migrateThrough(migrationIndex + 1)
        expect(await retainedReviews()).toEqual(beforeRows)
        expect(await contentRows()).toEqual(beforeContent)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        expect(await columns()).toEqual(
          beforeColumns.filter(
            ({ column_name }) =>
              !DROPPED_COLUMNS.some((dropped) => dropped === column_name),
          ),
        )
        const afterDrop = await constraints()
        for (const name of DROPPED_CHECKS) {
          expect(afterDrop.map(({ conname }) => conname)).not.toContain(name)
        }
        expect(afterDrop.find(({ conname }) => conname === CHECK)).toMatchObject({
          convalidated: false,
        })
        expect(await indexes()).toEqual(
          beforeIndexes.filter((name) => !DROPPED_INDEXES.includes(name)),
        )
        expect(await journal()).toHaveLength(migrationIndex + 1)

        await migrateThrough(migrationIndex + 2)
        expect(
          (await constraints()).find(({ conname }) => conname === CHECK),
        ).toMatchObject({
          convalidated: true,
        })

        const live = (
          await client.query<{ id: string }>(
            `SELECT id FROM reviews WHERE source_content_state = 'active' ORDER BY id LIMIT 1`,
          )
        ).rows[0]!
        await expect(
          client.query(
            `UPDATE reviews SET source_content_state = 'provider_deleted',
           source_content_erased_at = now() WHERE id = $1`,
            [live.id],
          ),
        ).rejects.toMatchObject({ code: '23514', constraint: CHECK })
        await expect(
          client.query(
            `UPDATE reviews SET source_content_erased_at = now() WHERE id = $1`,
            [live.id],
          ),
        ).rejects.toMatchObject({ code: '23514', constraint: CHECK })
        await expect(
          client.query(
            `UPDATE reviews SET source_content_state = 'provider_deleted',
           source_content_erased_at = now(), external_id = NULL,
           external_location_id = NULL, google_connection_id = NULL WHERE id = $1`,
            [live.id],
          ),
        ).resolves.toMatchObject({ rowCount: 1 })
        await client.query(
          `UPDATE reviews SET source_content_state = 'active',
         source_content_erased_at = NULL WHERE id = $1`,
          [live.id],
        )

        await migrateJournal(client, 'drizzle')
        const applied = await journal()
        expect(applied).toHaveLength(entries.length)
        expect(applied[migrationIndex]).toMatchObject({
          created_at: String(entries[migrationIndex]!.when),
          is_contract: true,
        })
        await migrateJournal(client, 'drizzle')
        expect(await journal()).toEqual(applied)
        expect(await contentRows()).toEqual(beforeContent)
      },
    ),
  150_000,
)
