import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const PRE_0118_MIGRATION = resolve(
  process.cwd(),
  'drizzle/0118_reply_publication_cycles.sql',
)
const RPL_MIGRATION = resolve(
  process.cwd(),
  'drizzle/0122_reply_google_observation_truth.sql',
)
const FIXTURE_SCHEMA = 'rpl_pre_0118_upgrade_fixture'

const schemaScoped = (sql: string): string =>
  sql.replaceAll('"public".', `"${FIXTURE_SCHEMA}".`)

async function createPre0118Fixture(client: PoolClient): Promise<void> {
  await client.query(`CREATE SCHEMA "${FIXTURE_SCHEMA}"`)
  await client.query(`SET LOCAL search_path TO "${FIXTURE_SCHEMA}", public`)
  await client.query(`
    CREATE TABLE reviews (
      id uuid PRIMARY KEY,
      organization_id varchar(255) NOT NULL,
      property_id uuid NOT NULL,
      UNIQUE (organization_id, property_id, id)
    );
    CREATE TABLE material_review_revisions (
      review_id uuid NOT NULL,
      revision bigint NOT NULL,
      organization_id varchar(255) NOT NULL,
      property_id uuid NOT NULL,
      source_epoch integer NOT NULL,
      PRIMARY KEY (review_id, revision)
    );
    CREATE TABLE replies (
      id uuid PRIMARY KEY,
      organization_id varchar(255) NOT NULL,
      review_id uuid NOT NULL,
      status varchar(32) NOT NULL,
      publication_state text,
      publication_attempts integer NOT NULL DEFAULT 0,
      publication_last_error_class text,
      reconcile_due_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT replies_publication_state_check CHECK (
        publication_state IN (
          'requested', 'authorized', 'sending', 'pending_observation',
          'published', 'terminal', 'ambiguous', 'cancelled'
        )
      ),
      CONSTRAINT replies_publication_last_error_class_check CHECK (
        publication_last_error_class IN (
          'terminal_rejection', 'retryable', 'ambiguous'
        )
      )
    );
    CREATE INDEX replies_publication_reconcile_idx
      ON replies (organization_id, reconcile_due_at)
      WHERE publication_state = 'ambiguous' AND reconcile_due_at IS NOT NULL;
    CREATE TABLE inbox_handling_cycles (
      opened_reason varchar(48) NOT NULL,
      CONSTRAINT inbox_handling_cycles_reason_valid CHECK (
        opened_reason IN (
          'legacy_backfill', 'review_observed', 'material_revision_changed',
          'manual_reopen', 'provider_reply_deleted', 'provider_reply_diverged'
        )
      )
    );

    INSERT INTO reviews (id, organization_id, property_id)
    VALUES (
      'a2000000-0000-4000-8000-000000000010',
      'org-rpl-pre-0118',
      'a2000000-0000-4000-8000-000000000001'
    );
    INSERT INTO material_review_revisions (
      review_id, revision, organization_id, property_id, source_epoch
    ) VALUES (
      'a2000000-0000-4000-8000-000000000010', 1,
      'org-rpl-pre-0118',
      'a2000000-0000-4000-8000-000000000001', 0
    );
    INSERT INTO replies (
      id, organization_id, review_id, status, publication_state,
      publication_attempts, publication_last_error_class, reconcile_due_at
    ) VALUES
      (
        'a2000000-0000-4000-8000-000000000021', 'org-rpl-pre-0118',
        'a2000000-0000-4000-8000-000000000010', 'approved', 'sending',
        1, NULL, NULL
      ),
      (
        'a2000000-0000-4000-8000-000000000022', 'org-rpl-pre-0118',
        'a2000000-0000-4000-8000-000000000010', 'approved',
        'pending_observation', 2, NULL, NULL
      ),
      (
        'a2000000-0000-4000-8000-000000000023', 'org-rpl-pre-0118',
        'a2000000-0000-4000-8000-000000000010', 'publish_failed', 'ambiguous',
        3, 'ambiguous', now()
      ),
      (
        'a2000000-0000-4000-8000-000000000024', 'org-rpl-pre-0118',
        'a2000000-0000-4000-8000-000000000010', 'approved', 'authorized',
        0, NULL, NULL
      );
  `)
}

describe('RPL migration from a pre-0118 publication state', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 1)
  })

  afterAll(async () => {
    await lease.release()
  })

  it('assigns uncertain legacy sends a reconciliation-only cycle without inventing authorization or attempt provenance', async () => {
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await createPre0118Fixture(client)

      // These rows existed before publication_cycle. Migration 0118 therefore
      // gives each the honest legacy value zero before RPL expands truth.
      await client.query(readFileSync(PRE_0118_MIGRATION, 'utf8'))
      const preRpl = await client.query<{ publication_cycle: string }>(
        `SELECT publication_cycle::text
         FROM replies
         WHERE publication_state IN ('sending', 'pending_observation', 'ambiguous')
         ORDER BY id`,
      )
      expect(preRpl.rows.map((row) => row.publication_cycle)).toEqual(['0', '0', '0'])

      await client.query(schemaScoped(readFileSync(RPL_MIGRATION, 'utf8')))

      const authorizationGuards = await client.query<{
        tgname: string
        tgenabled: string
      }>(`
        SELECT tgname, tgenabled
        FROM pg_trigger
        WHERE tgrelid = 'reply_publication_authorizations'::regclass
          AND tgname IN (
            'reply_publication_authorizations_immutable',
            'reply_publication_authorizations_truncate_guard'
          )
        ORDER BY tgname
      `)
      expect(authorizationGuards.rows).toEqual([
        {
          tgname: 'reply_publication_authorizations_immutable',
          tgenabled: 'A',
        },
        {
          tgname: 'reply_publication_authorizations_truncate_guard',
          tgenabled: 'A',
        },
      ])

      const uncertain = await client.query<{
        publication_cycle: string
        publication_attempts: number
        status: string
        publication_state: string
        publication_last_error_class: string
        reconcile_due_at: Date | null
      }>(`
        SELECT publication_cycle::text, publication_attempts, status,
               publication_state, publication_last_error_class, reconcile_due_at
        FROM replies
        WHERE id IN (
          'a2000000-0000-4000-8000-000000000021',
          'a2000000-0000-4000-8000-000000000022',
          'a2000000-0000-4000-8000-000000000023'
        )
        ORDER BY id
      `)
      expect(uncertain.rows).toEqual([
        expect.objectContaining({
          publication_cycle: '1',
          publication_attempts: 1,
          status: 'publish_failed',
          publication_state: 'ambiguous',
          publication_last_error_class: 'ambiguous',
          reconcile_due_at: expect.any(Date),
        }),
        expect.objectContaining({
          publication_cycle: '1',
          publication_attempts: 2,
          status: 'publish_failed',
          publication_state: 'ambiguous',
          publication_last_error_class: 'ambiguous',
          reconcile_due_at: expect.any(Date),
        }),
        expect.objectContaining({
          publication_cycle: '1',
          publication_attempts: 3,
          status: 'publish_failed',
          publication_state: 'ambiguous',
          publication_last_error_class: 'ambiguous',
          reconcile_due_at: expect.any(Date),
        }),
      ])

      const unsent = await client.query<{
        publication_cycle: string
        status: string
        publication_state: string
      }>(`
        SELECT publication_cycle::text, status, publication_state
        FROM replies
        WHERE id = 'a2000000-0000-4000-8000-000000000024'
      `)
      expect(unsent.rows[0]).toEqual({
        publication_cycle: '0',
        status: 'draft',
        publication_state: 'cancelled',
      })

      const evidence = await client.query<{
        authorizations: number
        attempts: number
        observations: number
      }>(`
        SELECT
          (SELECT count(*)::int FROM reply_publication_authorizations)
            AS authorizations,
          (SELECT count(*)::int FROM reply_publication_attempts) AS attempts,
          (SELECT count(*)::int FROM google_reply_observations) AS observations
      `)
      expect(evidence.rows[0]).toEqual({
        authorizations: 0,
        attempts: 0,
        observations: 0,
      })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
