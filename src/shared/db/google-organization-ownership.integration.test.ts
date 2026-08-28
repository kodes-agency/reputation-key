import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

describe('0124 Google Organization ownership migrated catalog', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('has the journal head, capability label, validated constraint, and organization default', async () => {
    const [journal, labels, column, constraint] = await Promise.all([
      lease.pool.query<{ hash: string }>(
        `SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`,
      ),
      lease.pool.query<{ enumlabel: string }>(`
        SELECT enumlabel
        FROM pg_enum
        JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
        WHERE pg_type.typname = 'google_content_capability'
        ORDER BY enumsortorder
      `),
      lease.pool.query<{ column_default: string | null }>(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'google_connections'
          AND column_name = 'visibility'
      `),
      lease.pool.query<{ convalidated: boolean; definition: string }>(`
        SELECT
          constraint_row.convalidated,
          pg_get_constraintdef(constraint_row.oid, true) AS definition
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conname = 'google_connections_organization_owned_check'
      `),
    ])

    expect(journal.rowCount).toBe(1)
    expect(labels.rows.map((row) => row.enumlabel)).toContain('property.connect_gbp')
    expect(labels.rows.map((row) => row.enumlabel)).toContain('property.publish_reply')
    expect(column.rows[0]?.column_default).toContain("'organization'")
    expect(constraint.rows[0]).toMatchObject({ convalidated: true })
    expect(constraint.rows[0]?.definition).toContain("visibility = 'organization'")
  })

  it('rejects private persistence while retaining the provenance column', async () => {
    const id = randomUUID()
    await lease.pool.query('BEGIN')
    try {
      await expect(
        lease.pool.query(
          `INSERT INTO google_connections (
             id, organization_id, google_subject, encrypted_access_token,
             encrypted_refresh_token, token_expires_at, scopes, connected_by,
             visibility
           ) VALUES ($1, $2, $3, 'encrypted-access', 'encrypted-refresh',
             NOW() + INTERVAL '1 hour',
             ARRAY['https://www.googleapis.com/auth/business.manage']::text[],
             $4, 'private')`,
          [id, `org-${id}`, `subject-${id}`, `provenance-${id}`],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await lease.pool.query('ROLLBACK')
    }
  })

  it('reconciles legacy connector rows and quarantines non-AccountAdmin credentials', async () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/0124_google_organization_ownership.sql'),
      'utf8',
    )
    const updateStart = migration.indexOf('UPDATE "google_connections" AS connection')
    const updateEnd = migration.indexOf(';--> statement-breakpoint', updateStart)
    expect(updateStart).toBeGreaterThanOrEqual(0)
    expect(updateEnd).toBeGreaterThan(updateStart)
    const ownerConnection = randomUUID()
    const managerConnection = randomUUID()
    const organization = `org-${randomUUID()}`
    const owner = `owner-${randomUUID()}`
    const manager = `manager-${randomUUID()}`
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `ALTER TABLE google_connections
           DROP CONSTRAINT google_connections_organization_owned_check`,
      )
      await client.query(
        `INSERT INTO organization (id, name, slug, "createdAt")
         VALUES ($1, 'Migration organization', $1, now())`,
        [organization],
      )
      await client.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES
           ($1, 'Owner', $3, true, now(), now()),
           ($2, 'Manager', $4, true, now(), now())`,
        [owner, manager, `${owner}@example.com`, `${manager}@example.com`],
      )
      await client.query(
        `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
         VALUES
           ($1, $2, $5, 'owner', now()),
           ($3, $4, $5, 'admin', now())`,
        [`member-${owner}`, owner, `member-${manager}`, manager, organization],
      )
      await client.query(
        `INSERT INTO google_connections (
          id, organization_id, google_subject, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, scopes, connected_by,
          visibility, status, credential_use_state, lifecycle_version,
          access_version, credential_generation
        ) VALUES
          ($1, $3, $4, 'access', 'refresh', now() + interval '1 hour',
            ARRAY['scope']::text[], $5, 'private', 'active', 'active', 7, 5, 3),
          ($2, $3, $6, 'access', 'refresh', now() + interval '1 hour',
            ARRAY['scope']::text[], $7, 'private', 'active', 'active', 7, 5, 3)`,
        [
          ownerConnection,
          managerConnection,
          organization,
          `subject-${ownerConnection}`,
          owner,
          `subject-${managerConnection}`,
          manager,
        ],
      )
      const scopedUpdate = `${migration.slice(updateStart, updateEnd)}
        WHERE connection.id = ANY($1::uuid[])`
      await client.query(scopedUpdate, [[ownerConnection, managerConnection]])
      const rows = await client.query<{
        id: string
        visibility: string
        connected_by: string
        status: string
        access_version: number
        lifecycle_version: number
        status_reason: string | null
      }>(
        `SELECT id, visibility, connected_by, status, access_version,
                lifecycle_version, status_reason
           FROM google_connections
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [[ownerConnection, managerConnection]],
      )
      const byId = new Map(rows.rows.map((row) => [row.id, row]))
      expect(byId.get(ownerConnection)).toMatchObject({
        visibility: 'organization',
        connected_by: owner,
        status: 'active',
        access_version: 6,
        lifecycle_version: 7,
        status_reason: null,
      })
      expect(byId.get(managerConnection)).toMatchObject({
        visibility: 'organization',
        connected_by: manager,
        status: 'reauth_required',
        access_version: 6,
        lifecycle_version: 8,
        status_reason: 'organization_ownership_requires_account_admin_reauthorization',
      })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('persists organization visibility by default and leaves connectedBy unchanged', async () => {
    const id = randomUUID()
    await lease.pool.query('BEGIN')
    try {
      await lease.pool.query(
        `INSERT INTO google_connections (
           id, organization_id, google_subject, encrypted_access_token,
           encrypted_refresh_token, token_expires_at, scopes, connected_by
         ) VALUES ($1, $2, $3, 'encrypted-access', 'encrypted-refresh',
           NOW() + INTERVAL '1 hour',
           ARRAY['https://www.googleapis.com/auth/business.manage']::text[], $4)`,
        [id, `org-${id}`, `subject-${id}`, `provenance-${id}`],
      )
      const row = await lease.pool.query<{ visibility: string; connected_by: string }>(
        `SELECT visibility, connected_by FROM google_connections WHERE id = $1`,
        [id],
      )
      expect(row.rows[0]).toEqual({
        visibility: 'organization',
        connected_by: `provenance-${id}`,
      })
    } finally {
      await lease.pool.query('ROLLBACK')
    }
  })

  it('atomically fences a direct support removal and records one durable notification fact', async () => {
    const connectionId = randomUUID()
    const untouchedConnectionId = randomUUID()
    const organization = `org-${randomUUID()}`
    const connector = `connector-${randomUUID()}`
    const reauthorizer = `reauthorizer-${randomUUID()}`
    await lease.pool.query('BEGIN')
    try {
      await lease.pool.query(
        `INSERT INTO organization (id, name, slug, "createdAt")
         VALUES ($1, 'Departure organization', $1, now())`,
        [organization],
      )
      await lease.pool.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES
           ($1, 'Connector', $3, true, now(), now()),
           ($2, 'Reauthorizer', $4, true, now(), now())`,
        [
          connector,
          reauthorizer,
          `${connector}@example.com`,
          `${reauthorizer}@example.com`,
        ],
      )
      await lease.pool.query(
        `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
         VALUES
           ($1, $2, $5, 'owner', now()),
           ($3, $4, $5, 'owner', now())`,
        [
          `member-${connector}`,
          connector,
          `member-${reauthorizer}`,
          reauthorizer,
          organization,
        ],
      )
      await lease.pool.query(
        `INSERT INTO google_connections (
           id, organization_id, google_subject, encrypted_access_token,
           encrypted_refresh_token, token_expires_at, scopes, connected_by,
           credential_authorized_by, credential_authorized_at,
           lifecycle_version, access_version
         ) VALUES
           ($1, $3, $4, 'access', 'refresh', now() + interval '1 hour',
            ARRAY['scope']::text[], $5, $5, now(), 4, 7),
           ($2, $3, $6, 'access', 'refresh', now() + interval '1 hour',
            ARRAY['scope']::text[], $5, $7, now(), 4, 7)`,
        [
          connectionId,
          untouchedConnectionId,
          organization,
          `subject-${connectionId}`,
          connector,
          `subject-${untouchedConnectionId}`,
          reauthorizer,
        ],
      )

      await lease.pool.query(
        `DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
        [organization, connector],
      )

      const rows = await lease.pool.query<{
        id: string
        status: string
        lifecycle_version: number
        access_version: number
      }>(
        `SELECT id, status, lifecycle_version, access_version
           FROM google_connections
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [[connectionId, untouchedConnectionId]],
      )
      const byId = new Map(rows.rows.map((row) => [row.id, row]))
      expect(byId.get(connectionId)).toMatchObject({
        status: 'reauth_required',
        lifecycle_version: 5,
        access_version: 8,
      })
      expect(byId.get(untouchedConnectionId)).toMatchObject({
        status: 'active',
        lifecycle_version: 4,
        access_version: 7,
      })

      const facts = await lease.pool.query<{
        source_aggregate_id: string
        payload: Record<string, unknown>
      }>(
        `SELECT source_aggregate_id, payload
           FROM outbox_events
          WHERE organization_id = $1
            AND event_type = 'integration.google_account.reauthorization_required'`,
        [organization],
      )
      expect(facts.rows).toHaveLength(1)
      expect(facts.rows[0]).toMatchObject({
        source_aggregate_id: connectionId,
        payload: {
          connectionId,
          organizationId: organization,
          cause: 'member_removed',
          correlationId: null,
        },
      })
      expect(facts.rows[0]?.payload.occurredAt).toEqual(expect.any(String))
    } finally {
      await lease.pool.query('ROLLBACK')
    }
  })

  it('installs the latest DB authority without connector or visibility predicates', async () => {
    const result = await lease.pool.query<{ definition: string }>(`
      SELECT pg_get_functiondef(procedure_row.oid) AS definition
      FROM pg_proc AS procedure_row
      JOIN pg_namespace AS namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND procedure_row.proname = 'start_google_execution_permit_v1'
    `)
    expect(result.rowCount).toBe(1)
    const definition = result.rows[0]!.definition
    expect(definition).not.toContain('connection.visibility')
    expect(definition).not.toContain('connection.connected_by')
    expect(definition).toContain("member.role = 'owner'")
    expect(definition).toContain("member.role = 'admin'")
    expect(definition).toContain('permission.version::text')
    expect(definition).toContain("permit.capability::text = 'property.connect_gbp'")
    expect(definition).toContain("permit.capability::text = 'property.publish_reply'")
    expect(definition).toContain('permit.initiator_user_id IS NULL')
    expect(definition).toContain("'review-sync-worker-v1'")
    expect(definition).toContain("'reply-publication-worker-v1'")
    expect(definition).toContain('reply_publication_attempts')
    expect(definition).toContain('reply_publication_authorizations')
  })
})
