import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '#/shared/db/schema'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId } from '#/shared/domain/ids'
import { createSetupChecklistRepository } from './setup-checklist.repository'

const ORG = organizationId(`org-setup-${randomUUID()}`)
const OTHER_ORG = organizationId(`org-setup-other-${randomUUID()}`)
const CONNECTION = randomUUID()
const PROPERTY = randomUUID()
const PORTAL = randomUUID()
const SNAPSHOT = randomUUID()
const COMPLETED_AT = new Date('2026-08-20T10:00:00.000Z')
let pool: Pool
let db: Database

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await pool.query('BEGIN')
  db = drizzle(pool, { schema }) as unknown as Database
  for (const [id, slug] of [
    [ORG, `setup-${randomUUID()}`],
    [OTHER_ORG, `setup-other-${randomUUID()}`],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Setup checklist test', $2, $3)`,
      [id, slug, COMPLETED_AT],
    )
  }
  await pool.query(
    `INSERT INTO google_connections
       (id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        credential_authorized_by, credential_authorized_at, visibility, status,
        credential_use_state, created_at, updated_at, status_changed_at)
     VALUES ($1, $2, $3, 'sealed-access', 'sealed-refresh', $4,
             ARRAY['business.manage'], 'admin-1', 'admin-1', $5,
             'organization', 'active', 'active', $5, $5, $5)`,
    [
      CONNECTION,
      ORG,
      `google-subject-${randomUUID()}`,
      new Date('2026-09-20T10:00:00.000Z'),
      COMPLETED_AT,
    ],
  )
})

beforeEach(async () => {
  await pool.query(
    `UPDATE google_connections
     SET status = 'active', status_reason = NULL, status_changed_at = $2
     WHERE organization_id = $1 AND id = $3`,
    [ORG, COMPLETED_AT, CONNECTION],
  )
})

afterAll(async () => {
  await pool.query('ROLLBACK')
  await pool.end()
})

describe('setup checklist repository', () => {
  it('records the first healthy connection once and keeps it after degradation', async () => {
    const repository = createSetupChecklistRepository(db)

    const healthy = await repository.readAndRecord({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })
    expect(healthy.googleConnection).toEqual({
      currentlySatisfied: true,
      firstCompletedAt: COMPLETED_AT,
    })

    await pool.query(
      `UPDATE google_connections
       SET status = 'degraded', status_reason = 'provider_unavailable',
           status_changed_at = $2
       WHERE organization_id = $1 AND id = $3`,
      [ORG, new Date('2026-08-21T10:00:00.000Z'), CONNECTION],
    )

    const degraded = await repository.readAndRecord({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })
    expect(degraded.googleConnection).toEqual({
      currentlySatisfied: false,
      firstCompletedAt: COMPLETED_AT,
    })
  })

  it('never exposes another Organization milestone', async () => {
    const repository = createSetupChecklistRepository(db)

    const other = await repository.readAndRecord({
      organizationId: OTHER_ORG,
      accessiblePropertyIds: null,
    })

    expect(other.googleConnection).toEqual({
      currentlySatisfied: false,
      firstCompletedAt: null,
    })
  })

  it('derives and preserves every canonical milestone without a manual completion path', async () => {
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, google_connection_id,
         gbp_account_id, gbp_location_id, google_binding_state, profile_source,
         profile_confirmed_at, profile_confirmed_by, country_code, country_source,
         timezone_source, timezone_resolved_at, source_epoch, created_at, updated_at
       ) VALUES (
         $1, $2, 'Canonical setup property', $3, 'America/New_York', $4,
         'account-setup', 'location-setup', 'active', 'tenant_confirmed',
         $5, 'admin-1', 'US', 'tenant_confirmed', 'tenant_confirmed', $5,
         0, $5, $5
       )`,
      [PROPERTY, ORG, `canonical-${randomUUID()}`, CONNECTION, COMPLETED_AT],
    )
    await pool.query(
      `INSERT INTO review_provider_snapshot_runs (
         id, organization_id, property_id, source_epoch, state, phase,
         expected_total, expected_average_rating, started_at, expires_at,
         terminal_at, record_expires_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 0, 'completed', 'terminal', 1, 5,
         $4, $5, $4, $5, $4, $4
       )`,
      [
        randomUUID(),
        ORG,
        PROPERTY,
        COMPLETED_AT,
        new Date(COMPLETED_AT.getTime() + 30 * 24 * 60 * 60 * 1_000),
      ],
    )
    await pool.query(
      `INSERT INTO portals (
         id, organization_id, property_id, entity_type, entity_id, name, slug,
         publication_state, created_at, updated_at
       ) VALUES ($1, $2, $3::uuid, 'property', $4, 'Lobby', $5, 'published', $6, $6)`,
      [PORTAL, ORG, PROPERTY, PROPERTY, `lobby-${randomUUID()}`, COMPLETED_AT],
    )
    await pool.query(
      `INSERT INTO portal_publication_snapshots (
         id, organization_id, property_id, portal_id, version,
         configuration_digest, configuration, guest_locale,
         language_pack_version, private_feedback_threshold, destination_uri,
         destination_retrieved_at, destination_source_epoch,
         destination_profile_version, created_by, created_at
       ) VALUES (
         $1, $2, $3, $4, 1, repeat('a', 64), '{}'::jsonb, 'en',
         'guest-ui-en-v1', 3, 'https://example.test/review', $5, 0, 1,
         'admin-1', $5
       )`,
      [SNAPSHOT, ORG, PROPERTY, PORTAL, COMPLETED_AT],
    )
    await pool.query(
      `INSERT INTO portal_publication_activations (
         id, organization_id, property_id, portal_id, snapshot_id,
         activation_sequence, kind, activated_by, activated_at
       ) VALUES ($1, $2, $3, $4, $5, 1, 'publish', 'admin-1', $6)`,
      [randomUUID(), ORG, PROPERTY, PORTAL, SNAPSHOT, COMPLETED_AT],
    )
    await pool.query(
      `INSERT INTO portal_health_intervals (
         id, organization_id, property_id, portal_id, status, reason,
         source_version, effective_from, observed_at
       ) VALUES ($1, $2, $3, $4, 'healthy', 'operational', 'setup-v1', $5, $5)`,
      [randomUUID(), ORG, PROPERTY, PORTAL, COMPLETED_AT],
    )
    await pool.query(
      `INSERT INTO property_responsible_managers (
         id, organization_id, property_id, user_id, effective_from, created_by
       ) VALUES ($1, $2, $3, 'manager-1', $4, 'admin-1')`,
      [randomUUID(), ORG, PROPERTY, COMPLETED_AT],
    )
    await pool.query(
      `INSERT INTO portal_responsible_managers (
         id, organization_id, property_id, portal_id, user_id,
         effective_from, created_by
       ) VALUES ($1, $2, $3, $4, 'manager-1', $5, 'admin-1')`,
      [randomUUID(), ORG, PROPERTY, PORTAL, COMPLETED_AT],
    )

    const repository = createSetupChecklistRepository(db)
    const complete = await repository.readAndRecord({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })

    expect(complete).toEqual({
      anchorPropertyId: PROPERTY,
      googleConnection: {
        currentlySatisfied: true,
        firstCompletedAt: COMPLETED_AT,
      },
      initialReviewSync: {
        currentlySatisfied: true,
        firstCompletedAt: COMPLETED_AT,
      },
      publishedPortal: {
        currentlySatisfied: true,
        firstCompletedAt: COMPLETED_AT,
      },
      responsibleManagers: {
        currentlySatisfied: true,
        firstCompletedAt: COMPLETED_AT,
      },
    })

    await pool.query(
      `UPDATE portal_health_intervals
       SET effective_to = $1
       WHERE organization_id = $2 AND portal_id = $3 AND effective_to IS NULL`,
      [new Date(COMPLETED_AT.getTime() + 1_000), ORG, PORTAL],
    )
    const degraded = await repository.readAndRecord({
      organizationId: ORG,
      accessiblePropertyIds: null,
    })

    expect(degraded.publishedPortal).toEqual({
      currentlySatisfied: false,
      firstCompletedAt: COMPLETED_AT,
    })
  })
})
