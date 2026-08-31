import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const SCHEMA = 'act_recent_activity_migration_test'
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0160_recent_activity_identifiers.sql'),
  'utf8',
)

describe('0160 Recent Activity identifiers (real PostgreSQL)', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await lease?.release()
  })

  it('preserves rows, supports old binaries through the view, and rolls back without data loss', async () => {
    const client = await lease.pool.connect()
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
      await client.query(`CREATE SCHEMA ${SCHEMA}`)
      await client.query(`SET search_path TO ${SCHEMA}`)
      await client.query(`
        CREATE TABLE activity_log (
          id uuid PRIMARY KEY,
          actor_id varchar(255) NOT NULL,
          actor_name varchar(255) NOT NULL,
          actor_avatar_url text,
          actor_role varchar(50) NOT NULL,
          action varchar(50) NOT NULL,
          resource_type varchar(50) NOT NULL,
          resource_id varchar(255) NOT NULL,
          property_id varchar(255),
          organization_id varchar(255) NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          event_id varchar(255),
          source varchar(20) NOT NULL DEFAULT 'web',
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX activity_log_resource_idx ON activity_log(resource_type, resource_id, created_at);
        CREATE INDEX activity_log_org_property_idx ON activity_log(organization_id, property_id, created_at);
        CREATE INDEX activity_log_event_id_idx ON activity_log(event_id);
        CREATE INDEX activity_log_actor_idx ON activity_log(actor_id, created_at);
        CREATE UNIQUE INDEX activity_log_event_id_org_uniq ON activity_log(event_id, organization_id);
      `)
      await client.query(`
        INSERT INTO activity_log (
          id, actor_id, actor_name, actor_role, action, resource_type,
          resource_id, organization_id, event_id
        ) VALUES (
          'f3000000-0000-4000-8000-000000000001', 'actor-1', 'Actor',
          'AccountAdmin', 'created', 'property', 'property-1', 'org-1', 'event-1'
        )
      `)

      await client.query('BEGIN')
      await client.query(migration)

      const canonical = await client.query(
        'SELECT id::text FROM recent_activity_entries ORDER BY id',
      )
      expect(canonical.rows).toEqual([{ id: 'f3000000-0000-4000-8000-000000000001' }])
      await client.query(`
        INSERT INTO activity_log (
          id, actor_id, actor_name, actor_role, action, resource_type,
          resource_id, organization_id, event_id
        ) VALUES (
          'f3000000-0000-4000-8000-000000000002', 'actor-2', 'Actor',
          'AccountAdmin', 'created', 'property', 'property-2', 'org-1', 'event-2'
        )
      `)
      const throughCanonical = await client.query(
        'SELECT count(*)::integer AS count FROM recent_activity_entries',
      )
      expect(throughCanonical.rows[0]).toEqual({ count: 2 })
      await client.query(`
        UPDATE activity_log
        SET actor_name = 'Updated through compatibility view'
        WHERE id = 'f3000000-0000-4000-8000-000000000001'::uuid
      `)
      const updatedThroughCanonical = await client.query(
        `SELECT actor_name FROM recent_activity_entries
         WHERE id = 'f3000000-0000-4000-8000-000000000001'::uuid`,
      )
      expect(updatedThroughCanonical.rows[0]).toEqual({
        actor_name: 'Updated through compatibility view',
      })
      await client.query(`
        DELETE FROM activity_log
        WHERE id = 'f3000000-0000-4000-8000-000000000002'::uuid
      `)
      const deletedThroughCanonical = await client.query(
        'SELECT count(*)::integer AS count FROM recent_activity_entries',
      )
      expect(deletedThroughCanonical.rows[0]).toEqual({ count: 1 })

      await client.query('ROLLBACK')

      const rolledBack = await client.query(
        'SELECT id::text FROM activity_log ORDER BY id',
      )
      expect(rolledBack.rows).toEqual([{ id: 'f3000000-0000-4000-8000-000000000001' }])
      const relation = await client.query(
        `SELECT relkind FROM pg_class WHERE oid = '${SCHEMA}.activity_log'::regclass`,
      )
      expect(relation.rows[0]).toEqual({ relkind: 'r' })
      const absentCanonical = await client.query(
        `SELECT to_regclass('${SCHEMA}.recent_activity_entries') AS relation`,
      )
      expect(absentCanonical.rows[0]).toEqual({ relation: null })
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.query('SET search_path TO public')
      client.release()
    }
  })
})
