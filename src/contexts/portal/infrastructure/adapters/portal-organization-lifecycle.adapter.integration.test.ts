// LIF-01-T12/T13/T14 — Portal lifecycle contribution against real PostgreSQL.
//
// The unit test proves the decisions. Only a real schema can prove the three
// properties an operator has to trust:
//   * Closing takes every Portal off the air and DELETES NOTHING;
//   * purge readiness MUTATES NOTHING, and fails closed while a printed
//     Portal address still resolves;
//   * purge empties every table in the Portal plan for one Organization while
//     a second Organization's rows stay byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import {
  PORTAL_PURGE_PLAN,
  PORTAL_PURGE_READINESS_BLOCKED,
  createPortalOrganizationLifecycleContributor,
} from './portal-organization-lifecycle.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const DIGEST = 'a'.repeat(64)
const OCCURRED_AT = new Date('2027-01-15T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2027-02-14T00:00:00.000Z')

/** Every table the Portal plan touches, plus `properties` as a control. */
const OBSERVED_TABLES = [...PORTAL_PURGE_PLAN, 'properties'] as const

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  portalGroupId: string
  snapshotId: string
  activationId: string
  tokenId: string
  destinationId: string
}>

async function counts(organizationId: string): Promise<Record<string, number>> {
  const entries = await Promise.all(
    OBSERVED_TABLES.map(async (table) => {
      const result = await lease.pool.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id = $1`,
        [organizationId],
      )
      return [table, Number(result.rows[0]?.count ?? 0)] as const
    }),
  )
  return Object.fromEntries(entries)
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = `portal-lifecycle-org-${randomUUID()}`
  organizations.add(organizationId)
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    portalGroupId: randomUUID(),
    snapshotId: randomUUID(),
    activationId: randomUUID(),
    tokenId: randomUUID(),
    destinationId: randomUUID(),
  }
  const q = (text: string, values: readonly unknown[]) =>
    lease.pool.query(text, [...values])
  const scope = [organizationId, fixture.propertyId, fixture.portalId]
  const actor = `portal-lifecycle-actor-${randomUUID()}`

  await q(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Portal Lifecycle Fixture', $1, now())`,
    [organizationId],
  )
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', now(), now())`,
    [fixture.propertyId, organizationId],
  )
  await q(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Ground floor', now(), now())`,
    [fixture.portalGroupId, organizationId, fixture.propertyId],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                          publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Front Desk', 'front-desk', 'published', now(), now())`,
    [fixture.portalId, organizationId, fixture.propertyId, fixture.propertyId],
  )
  await q(
    `INSERT INTO portal_group_members (id, portal_group_id, portal_id, organization_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [randomUUID(), fixture.portalGroupId, fixture.portalId, organizationId],
  )
  await q(
    `INSERT INTO property_portal_brand_profiles (
       id, organization_id, property_id, display_name, primary_color,
       background_color, text_color, updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Harbour House', '#112233', '#FFFFFF', '#000000', $4, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, actor],
  )
  await q(
    `INSERT INTO property_portal_brand_contents (
       id, organization_id, property_id, locale, title, short_description,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Harbour House', 'By the water', $4, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, actor],
  )
  await q(
    `INSERT INTO portal_localized_overrides (
       id, organization_id, property_id, portal_id, locale, title, updated_by,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'en', 'Front Desk', $5, now(), now())`,
    [randomUUID(), ...scope, actor],
  )
  await q(
    `INSERT INTO portal_health_intervals (
       id, organization_id, property_id, portal_id, status, reason, source_version,
       effective_from, observed_at
     ) VALUES ($1, $2, $3, $4, 'healthy', 'destination_verified', 'v1', now(), now())`,
    [randomUUID(), ...scope],
  )
  await q(
    `INSERT INTO portal_approved_destinations (
       id, organization_id, property_id, normalized_uri, hostname, source_type,
       approval_state, validation_version, requested_by, approved_by, approved_at,
       last_validated_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'https://example.test/menu', 'example.test', 'custom',
               'approved', 'v1', $4, $4, now(), now(), now(), now())`,
    [fixture.destinationId, organizationId, fixture.propertyId, actor],
  )
  const categoryId = randomUUID()
  await q(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Explore', 'a', now(), now())`,
    [categoryId, fixture.portalId, organizationId],
  )
  await q(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, destination_id, legacy_destination_state, sort_key,
                               created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Menu', $6, 'migrated', 'a', now(), now())`,
    [
      randomUUID(),
      categoryId,
      fixture.portalId,
      organizationId,
      fixture.propertyId,
      fixture.destinationId,
    ],
  )
  await q(
    `INSERT INTO portal_responsible_managers (
       id, organization_id, property_id, portal_id, user_id, effective_from, created_by
     ) VALUES ($1, $2, $3, $4, $5, now(), $5)`,
    [randomUUID(), ...scope, actor],
  )
  await q(
    `INSERT INTO portal_tokens (id, organization_id, property_id, portal_id,
                                token_identifier, token_hash, version, status,
                                issued_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', now(), now())`,
    [
      fixture.tokenId,
      ...scope,
      randomUUID().replaceAll('-', '').slice(0, 24),
      randomUUID().replaceAll('-', '').padEnd(64, 'f').slice(0, 64),
    ],
  )
  await q(
    `INSERT INTO portal_access_artifacts (id, organization_id, property_id, portal_id,
                                          portal_token_id, channel, status, published_at)
     VALUES ($1, $2, $3, $4, $5, 'qr', 'published', now())`,
    [randomUUID(), ...scope, fixture.tokenId],
  )
  const issuanceId = randomUUID()
  await q(
    `INSERT INTO portal_upload_issuances (
       id, organization_id, property_id, portal_id, purpose, object_key, content_type,
       declared_size_bytes, max_size_bytes, state, issued_at, expires_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'hero_image', $5, 'image/jpeg',
               1024, 10485760, 'issued', now(), now() + interval '1 hour', now(), now())`,
    [issuanceId, ...scope, `private/portal-uploads/${issuanceId}/source.jpg`],
  )
  await q(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', now(), 0, 1, $6, now())`,
    [fixture.snapshotId, ...scope, DIGEST, actor],
  )
  await q(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id, activation_sequence,
       kind, activated_by, activated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'publish', $6, $7)`,
    [
      fixture.activationId,
      ...scope,
      fixture.snapshotId,
      actor,
      new Date(OCCURRED_AT.getTime() - 86_400_000),
    ],
  )
  await q(
    `INSERT INTO portal_pending_content_changes (
       id, organization_id, property_id, portal_id, change_kind, change_key,
       source_version, changed_at
     ) VALUES ($1, $2, $3, $4, 'portal_links', 'all', 'v2', now())`,
    [randomUUID(), ...scope],
  )
  return fixture
}

async function seedAuthority(
  fixture: Fixture,
  lineage: string,
  target: 'closure_requested' | 'closing' | 'purging',
): Promise<number> {
  const requestAt = new Date(OCCURRED_AT.getTime() - 5000)
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = 1, closure_lineage_id = $2,
         closure_requested_at = $3, recoverable_until = $4,
         reactivation_required = true, requested_by = 'admin:lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [fixture.organizationId, lineage, requestAt, RECOVERABLE_UNTIL],
  )
  if (target === 'closure_requested') return 1

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closing', revision = 2, last_transition_at = $2,
         last_actor_id = 'system:lifecycle', last_reason_code = 'closing_prepared',
         last_support_evidence_ref = 'test:closing-prepared'
     WHERE organization_id = $1`,
    [fixture.organizationId, new Date(OCCURRED_AT.getTime() - 4000)],
  )
  if (target === 'closing') return 2

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purge_pending', revision = 3, last_transition_at = $2,
         last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'recovery_window_waived',
         last_support_evidence_ref = 'test:recovery-waived'
     WHERE organization_id = $1`,
    [fixture.organizationId, new Date(OCCURRED_AT.getTime() - 3000)],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purging', revision = 4, irreversible_at = $2,
         last_transition_at = $2, last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'irreversible_purge_authorized',
         last_support_evidence_ref = 'test:purge-authorized'
     WHERE organization_id = $1`,
    [fixture.organizationId, new Date(OCCURRED_AT.getTime() - 2000)],
  )
  return 4
}

function input(
  fixture: Fixture,
  lineage: string,
  revision: number,
): OrganizationLifecycleContributionInput {
  return {
    organizationId: fixture.organizationId,
    closureLineageId: lineage,
    lifecycleRevision: revision,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  }
}

/** The exact predicate public Portal resolution uses before Portal Health. */
async function resolvablePortalCount(organizationId: string): Promise<number> {
  const result = await lease.pool.query(
    `SELECT COUNT(*)::int AS count
     FROM portal_tokens t
     JOIN portals p ON p.organization_id = t.organization_id AND p.id = t.portal_id
     JOIN portal_publication_activations a
       ON a.organization_id = t.organization_id AND a.portal_id = t.portal_id
      AND a.deactivated_at IS NULL
     WHERE t.organization_id = $1
       AND p.publication_state = 'published'
       AND p.deleted_at IS NULL`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function deleteReceiptFixtures(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `ALTER TABLE organization_lifecycle_events
       DISABLE TRIGGER organization_lifecycle_events_append_only`,
    )
    await client.query(
      `DELETE FROM organization_lifecycle_events
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    await client.query(
      `ALTER TABLE organization_lifecycle_events
       ENABLE ALWAYS TRIGGER organization_lifecycle_events_append_only`,
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const CLEANUP_ORDER = [
  'portal_access_artifacts',
  'portal_upload_issuances',
  'portal_pending_content_changes',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_health_intervals',
  'portal_links',
  'portal_link_categories',
  'portal_responsible_managers',
  'portal_tokens',
  'portal_group_members',
  'portal_localized_overrides',
  'portal_approved_destinations',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portals',
  'portal_groups',
  'properties',
] as const

describe.sequential('Portal Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    for (const table of CLEANUP_ORDER) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await deleteReceiptFixtures(ids)
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('takes every Portal off the air on Closing and deletes nothing', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture, lineage, 'closure_requested')
    const before = await counts(fixture.organizationId)
    expect(await resolvablePortalCount(fixture.organizationId)).toBe(1)

    const result = await createPortalOrganizationLifecycleContributor(db).prepareClosing(
      input(fixture, lineage, revision),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: `portal:closing:complete:${lineage}:r${revision}`,
    })
    // The Portal is unavailable...
    expect(await resolvablePortalCount(fixture.organizationId)).toBe(0)
    // ...and NOTHING was deleted. Closing opens a recoverable window.
    expect(await counts(fixture.organizationId)).toEqual(before)

    // The stop is reversible: the immutable snapshot survives and the tenant's
    // own published intent is untouched, so reactivation re-points a new
    // activation at the same snapshot.
    const state = await lease.pool.query(
      `SELECT
         (SELECT publication_state FROM portals WHERE id = $2) AS publication_state,
         (SELECT deleted_at FROM portals WHERE id = $2) AS deleted_at,
         (SELECT COUNT(*)::int FROM portal_publication_snapshots
          WHERE organization_id = $1) AS snapshots,
         (SELECT deactivation_reason FROM portal_publication_activations
          WHERE id = $3) AS deactivation_reason,
         (SELECT deactivated_at FROM portal_publication_activations
          WHERE id = $3) AS deactivated_at`,
      [fixture.organizationId, fixture.portalId, fixture.activationId],
    )
    expect(state.rows[0]).toMatchObject({
      publication_state: 'published',
      deleted_at: null,
      snapshots: 1,
      deactivation_reason: 'disabled',
      deactivated_at: OCCURRED_AT,
    })

    const receipt = await lease.pool.query(
      `SELECT context, phase, payload->>'outcome' AS outcome,
              payload->>'evidenceRef' AS evidence_ref
       FROM organization_lifecycle_events
       WHERE organization_id = $1
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(receipt.rows).toEqual([
      {
        context: 'portal',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: `portal:closing:complete:${lineage}:r${revision}`,
      },
    ])
  })

  it('answers no_data for an Organization that owns no Portal row', async () => {
    const organizationId = `portal-lifecycle-org-${randomUUID()}`
    organizations.add(organizationId)
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Empty Portal Fixture', $1, now())`,
      [organizationId],
    )
    const fixture = {
      organizationId,
      propertyId: '',
      portalId: '',
      portalGroupId: '',
      snapshotId: '',
      activationId: '',
      tokenId: '',
      destinationId: '',
    }
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture, lineage, 'closure_requested')

    const result = await createPortalOrganizationLifecycleContributor(db).prepareClosing(
      input(fixture, lineage, revision),
    )

    // Affirmative absence, never an omitted contributor.
    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef: `portal:closing:no_data:${lineage}:r${revision}`,
    })
  })

  it('fails closed on readiness while a Portal address still resolves, and mutates nothing', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture, lineage, 'closing')
    const contributor = createPortalOrganizationLifecycleContributor(db)
    const before = await counts(fixture.organizationId)

    await expect(
      contributor.verifyPurgeReadiness(input(fixture, lineage, revision)),
    ).rejects.toThrow(PORTAL_PURGE_READINESS_BLOCKED)

    expect(await counts(fixture.organizationId)).toEqual(before)
    const receipts = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM organization_lifecycle_events
       WHERE organization_id = $1
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(Number(receipts.rows[0]?.count)).toBe(0)

    // Once the closing fence is in place the same read-only pass succeeds and
    // still changes no row.
    await lease.pool.query(
      `UPDATE portal_publication_activations
       SET deactivated_at = GREATEST(activated_at, $2::timestamptz),
           deactivation_reason = 'disabled'
       WHERE organization_id = $1 AND deactivated_at IS NULL`,
      [fixture.organizationId, OCCURRED_AT],
    )
    const fenced = await counts(fixture.organizationId)

    const result = await contributor.verifyPurgeReadiness(
      input(fixture, lineage, revision),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: `portal:purge_readiness:complete:${lineage}:r${revision}`,
    })
    expect(await counts(fixture.organizationId)).toEqual(fenced)
  })

  it('empties every planned table for one Organization and leaves another untouched', async () => {
    const fixture = await seedFixture()
    const bystander = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture, lineage, 'purging')
    const bystanderBefore = await counts(bystander.organizationId)
    const contributor = createPortalOrganizationLifecycleContributor(db)

    const first = await contributor.purge(input(fixture, lineage, revision))

    expect(first).toEqual({
      outcome: 'complete',
      evidenceRef: `portal:purge:complete:${lineage}:r${revision}`,
    })
    const after = await counts(fixture.organizationId)
    for (const table of PORTAL_PURGE_PLAN) {
      expect({ table, rows: after[table] }).toEqual({ table, rows: 0 })
    }
    // The Property row is another owner's; Portal must not have removed it.
    expect(after.properties).toBe(1)
    // No tenant-cross deletion.
    expect(await counts(bystander.organizationId)).toEqual(bystanderBefore)

    // Idempotent: the replay returns the same receipt and the same zero counts.
    const replay = await contributor.purge({
      ...input(fixture, lineage, revision),
      occurredAt: new Date(OCCURRED_AT.getTime() + 60_000),
    })
    expect(replay).toEqual(first)
    expect(await counts(fixture.organizationId)).toEqual(after)
    const receipts = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM organization_lifecycle_events
       WHERE organization_id = $1 AND phase = 'purge'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(Number(receipts.rows[0]?.count)).toBe(1)
  })

  it('never drops a table or a compatibility mirror', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture, lineage, 'purging')

    await createPortalOrganizationLifecycleContributor(db).purge(
      input(fixture, lineage, revision),
    )

    const present = await lease.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...PORTAL_PURGE_PLAN]],
    )
    expect(present.rows.map((row) => row.table_name).sort()).toEqual(
      [...PORTAL_PURGE_PLAN].sort(),
    )
  })
})
