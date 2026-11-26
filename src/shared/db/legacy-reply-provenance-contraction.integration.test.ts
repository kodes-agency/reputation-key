import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0126_drop_legacy_reply_template_provenance'
const LEGACY_CHECK = 'replies_template_provenance_valid'
const LEGACY_COLUMNS = ['template_id', 'template_version'] as const

it(
  'refuses either populated legacy column atomically, then drops only obsolete provenance and preserves layered replies',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, entries, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        await migrateThrough(migrationIndex)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        const replyIds = (
          await client.query<{ id: string }>('SELECT id FROM replies ORDER BY id LIMIT 2')
        ).rows.map(({ id }) => id)
        expect(replyIds).toHaveLength(2)
        const replyId = replyIds[0]!
        await client.query(
          `UPDATE replies SET template_layer = 'builtin', template_ref = 'builtin:thanks',
         template_revision = 1, template_wording_key = 'default',
         voice_digest = $2, voice_choices = $3::jsonb
       WHERE id = $1`,
          [
            replyId,
            'a'.repeat(64),
            JSON.stringify({
              closing: 1,
              signOff: 2,
              contactSentence: 0,
              emoji: 0,
              includeContact: false,
            }),
          ],
        )
        const replyRows = async () =>
          (await client.query('SELECT * FROM replies ORDER BY id')).rows
        const retainedReplyRows = async () =>
          (
            await client.query(
              `SELECT to_jsonb(reply) - 'template_id' - 'template_version' AS row
           FROM replies reply ORDER BY id`,
            )
          ).rows
        const columns = async () =>
          (
            await client.query<{ column_name: string }>(
              `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'replies'
           ORDER BY ordinal_position`,
            )
          ).rows
        const constraints = async () =>
          (
            await client.query<{ conname: string }>(
              `SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint WHERE conrelid = 'public.replies'::regclass
           ORDER BY conname`,
            )
          ).rows
        const journal = async () =>
          (
            await client.query(
              'SELECT hash, created_at, is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
            )
          ).rows

        const expectRefusal = async (idCount: number, versionCount: number) => {
          const beforeRows = await replyRows()
          const beforeColumns = await columns()
          const beforeConstraints = await constraints()
          const beforeJournal = await journal()
          const refused = migrateThrough(migrationIndex + 1)
          await expect(refused).rejects.toThrow(
            new RegExp(`template_id\\b[^\\d;\\n]*\\b${idCount}\\b`),
          )
          await expect(refused).rejects.toThrow(
            new RegExp(`template_version\\b[^\\d;\\n]*\\b${versionCount}\\b`),
          )
          expect(await replyRows()).toEqual(beforeRows)
          expect(await columns()).toEqual(beforeColumns)
          expect(await constraints()).toEqual(beforeConstraints)
          expect(await journal()).toEqual(beforeJournal)
          expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        }

        await client.query(
          'UPDATE replies SET template_id = $2 WHERE id = ANY($1::uuid[])',
          [replyIds, randomUUID()],
        )
        await expectRefusal(2, 0)
        await client.query('UPDATE replies SET template_id = NULL')

        await client.query(
          'UPDATE replies SET template_id = $2, template_version = 7 WHERE id = $1',
          [replyId, randomUUID()],
        )
        await expectRefusal(1, 1)
        await client.query(
          'UPDATE replies SET template_id = NULL, template_version = NULL WHERE id = $1',
          [replyId],
        )

        const beforeRows = await retainedReplyRows()
        const beforeColumns = await columns()
        const beforeConstraints = await constraints()
        expect(beforeConstraints.map(({ conname }) => conname)).toContain(
          'replies_layered_template_provenance_valid',
        )
        await migrateThrough(migrationIndex + 1)
        expect(await retainedReplyRows()).toEqual(beforeRows)
        expect(await columns()).toEqual(
          beforeColumns.filter(
            ({ column_name }) => !LEGACY_COLUMNS.some((legacy) => legacy === column_name),
          ),
        )
        expect(await constraints()).toEqual(
          beforeConstraints.filter(({ conname }) => conname !== LEGACY_CHECK),
        )
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        expect(await journal()).toHaveLength(migrationIndex + 1)

        await expect(
          client.query("UPDATE replies SET template_layer = 'invalid' WHERE id = $1", [
            replyId,
          ]),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'replies_layered_template_provenance_valid',
        })
        expect(await retainedReplyRows()).toEqual(beforeRows)

        await migrateJournal(client, 'drizzle')
        const applied = await journal()
        expect(applied).toHaveLength(entries.length)
        expect(applied[migrationIndex]).toMatchObject({
          created_at: String(entries[migrationIndex]!.when),
          is_contract: true,
        })
        await migrateJournal(client, 'drizzle')
        expect(await journal()).toEqual(applied)
        expect(await retainedReplyRows()).toEqual(beforeRows)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
      },
    ),
  150_000,
)
