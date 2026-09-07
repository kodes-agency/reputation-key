// LIF-01-T12/T13/T14 — Guest lifecycle contribution against real PostgreSQL.
//
// Guest holds the most sensitive rows in the product, so this file proves the
// claims an operator and a privacy reviewer have to be able to check:
//   * Closing deletes and edits NOTHING — the recoverable window keeps data;
//   * purge readiness MUTATES NOTHING and fails closed while a Guest
//     correction is still undelivered, so corrections reach the anonymous
//     lifetime aggregate BEFORE the source facts are scrubbed;
//   * purge leaves no recoverable guest text, permitted contact or session
//     pseudonym anywhere, while the anonymous lifetime aggregate, the global
//     retention cursor and a second Organization survive untouched.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import {
  GUEST_PURGE_PLAN,
  GUEST_PURGE_READINESS_BLOCKED,
  createGuestOrganizationLifecycleContributor,
} from './guest-organization-lifecycle.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const DIGEST = 'a'.repeat(64)
const NOTICE_DIGEST = 'b'.repeat(64)
const PSEUDONYM = 'c'.repeat(64)
const OCCURRED_AT = new Date('2027-01-15T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2027-02-14T00:00:00.000Z')

/** Values that must be unrecoverable anywhere after the purge phase. */
const PRIVATE_TEXT = 'NEVER_SURVIVE_PRIVATE_FEEDBACK_BODY'
const LEGACY_COMMENT = 'NEVER_SURVIVE_LEGACY_FEEDBACK_COMMENT'
const CONTACT_CIPHERTEXT = 'NEVER_SURVIVE_CONTACT_CIPHERTEXT'
const IP_HASH = 'NEVER_SURVIVE_IP_HASH'

const OBSERVED_TABLES = [...GUEST_PURGE_PLAN] as const

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  contactRequestId: string
  sessionId: string
}>

async function counts(organizationId: string): Promise<Record<string, number>> {
  const entries = await Promise.all(
    OBSERVED_TABLES.map(async (table) => {
      const result =
        table === 'idempotency_receipts'
          ? await lease.pool.query(
              `SELECT COUNT(*)::int AS count FROM idempotency_receipts
               WHERE scope IN ('guest_qualified_scan', 'guest_destination_action')
                 AND payload->>'organizationId' = $1`,
              [organizationId],
            )
          : await lease.pool.query(
              `SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id = $1`,
              [organizationId],
            )
      return [table, Number(result.rows[0]?.count ?? 0)] as const
    }),
  )
  return Object.fromEntries(entries)
}

async function seedOrganization(): Promise<string> {
  const organizationId = `guest-lifecycle-org-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Guest Lifecycle Fixture', $1, now())`,
    [organizationId],
  )
  return organizationId
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = await seedOrganization()
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    responseId: randomUUID(),
    contactRequestId: randomUUID(),
    sessionId: randomUUID(),
  }
  const q = (text: string, values: readonly unknown[]) =>
    lease.pool.query(text, [...values])
  const scope = [organizationId, fixture.propertyId, fixture.portalId]
  const actor = `guest-lifecycle-actor-${randomUUID()}`
  const tokenId = randomUUID()
  const artifactId = randomUUID()
  const factsSnapshotId = randomUUID()
  const contactSnapshotId = randomUUID()
  const scanEventId = randomUUID()
  const qualifiedScanId = randomUUID()
  const ratingId = randomUUID()

  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', now(), now())`,
    [fixture.propertyId, organizationId],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                          publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Front Desk', 'front-desk', 'published', now(), now())`,
    [fixture.portalId, organizationId, fixture.propertyId, fixture.propertyId],
  )
  const snapshot = (id: string, version: number, contactEnabled: boolean) =>
    q(
      `INSERT INTO portal_publication_snapshots (
         id, organization_id, property_id, portal_id, version, configuration_digest,
         configuration, guest_locale, language_pack_version, private_feedback_threshold,
         contact_request_enabled, contact_notice_id, contact_notice_version,
         contact_notice_digest, contact_notice_locale, destination_uri,
         destination_retrieved_at, destination_source_epoch,
         destination_profile_version, created_by, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
                 $7, $8, $9, $10, $11, 'https://example.test/review', now(), 0, 1,
                 $12, now())`,
      [
        id,
        ...scope,
        version,
        DIGEST,
        contactEnabled,
        contactEnabled ? 'guest-contact-notice' : null,
        contactEnabled ? 'v1' : null,
        contactEnabled ? NOTICE_DIGEST : null,
        contactEnabled ? 'en' : null,
        actor,
      ],
    )
  await snapshot(factsSnapshotId, 1, false)
  await snapshot(contactSnapshotId, 2, true)
  await q(
    `INSERT INTO portal_tokens (id, organization_id, property_id, portal_id,
                                token_identifier, token_hash, version, status,
                                issued_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', now(), now())`,
    [
      tokenId,
      ...scope,
      randomUUID().replaceAll('-', '').slice(0, 24),
      randomUUID().replaceAll('-', '').padEnd(64, 'f').slice(0, 64),
    ],
  )
  await q(
    `INSERT INTO portal_access_artifacts (id, organization_id, property_id, portal_id,
                                          portal_token_id, channel, status, published_at)
     VALUES ($1, $2, $3, $4, $5, 'qr', 'published', now())`,
    [artifactId, ...scope, tokenId],
  )
  // Metric's anonymous lifetime aggregate. Guest must never touch it.
  await q(
    `INSERT INTO portal_metric_lifetime_aggregates (
       id, organization_id, property_id, portal_id, qualified_scan_count,
       private_rating_count, private_rating_sum, private_rating_2_count,
       private_feedback_count, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 12, 1, 2, 1, 1, now(), now())`,
    [randomUUID(), ...scope],
  )

  await q(
    `INSERT INTO guest_responses (
       id, organization_id, property_id, portal_id, status, rating,
       response_consent, text_consent, private_feedback_threshold,
       correction_count, submitted_at, feedback_submitted_at,
       feedback_submission_revision, retention_deadline, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'submitted', 2, true, true, 3, 0,
               now() - interval '2 days', now() - interval '2 days', 1,
               now() + interval '700 days', now() - interval '2 days', now())`,
    [fixture.responseId, ...scope],
  )
  await q(
    `INSERT INTO guest_response_private_feedback (
       response_id, organization_id, property_id, portal_id, body, submitted_at,
       expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, now() - interval '2 days',
               now() + interval '88 days', now())`,
    [fixture.responseId, ...scope, PRIVATE_TEXT],
  )
  await q(
    `INSERT INTO guest_response_integrity_decisions (
       id, response_id, organization_id, property_id, portal_id, revision, outcome,
       reason_code, source, actor_id, decided_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'accepted', 'legacy_included', 'system', $6,
               now(), now())`,
    [randomUUID(), fixture.responseId, ...scope, actor],
  )
  await q(
    `INSERT INTO guest_response_experience_snapshots (
       response_id, organization_id, property_id, portal_id, publication_state,
       publication_snapshot_id, publication_version, publication_digest,
       configuration_digest, guest_locale, language_pack_version,
       private_feedback_threshold, captured_at
     ) VALUES ($1, $2, $3, $4, 'published', $5, 1, $6, $6, 'en', 'guest-ui-en-v1', 3,
               now())`,
    [fixture.responseId, ...scope, factsSnapshotId, DIGEST],
  )
  await q(
    `INSERT INTO guest_response_session_bindings (
       response_id, organization_id, property_id, portal_id, session_id, expires_at,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', now())`,
    [fixture.responseId, ...scope, fixture.sessionId],
  )
  await q(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('guest_destination_action', $1, jsonb_build_object(
       'organizationId', $2::text, 'propertyId', $3::text, 'portalId', $4::text,
       'sessionId', $5::text, 'destinationId', 'google-review'
     ), now())`,
    [randomUUID(), ...scope, randomUUID()],
  )
  await q(
    `INSERT INTO scan_events (id, organization_id, portal_id, property_id, source,
                              session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 'qr', $5, $6, now())`,
    [
      scanEventId,
      organizationId,
      fixture.portalId,
      fixture.propertyId,
      fixture.sessionId,
      IP_HASH,
    ],
  )
  await q(
    `INSERT INTO guest_qualified_scans (
       id, organization_id, property_id, portal_id, access_artifact_id,
       source_event_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [qualifiedScanId, ...scope, artifactId, scanEventId],
  )
  await q(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('guest_qualified_scan', $1, jsonb_build_object(
       'organizationId', $2::text, 'propertyId', $3::text, 'portalId', $4::text,
       'sessionId', $5::text, 'qualifiedScanId', $6::text
     ), now())`,
    [randomUUID(), ...scope, fixture.sessionId, qualifiedScanId],
  )
  await q(
    `INSERT INTO guest_network_pressure_records (
       id, organization_id, property_id, portal_id, pseudonym, action, observed_at,
       expires_at
     ) VALUES ($1, $2, $3, $4, $5, 'rating', now(), now() + interval '7 days')`,
    [randomUUID(), ...scope, PSEUDONYM],
  )
  // Compatibility mirrors: guest content that has no canonical successor.
  await q(
    `INSERT INTO ratings (id, organization_id, portal_id, property_id, value, source,
                          session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 4, 'qr', $5, $6, now())`,
    [
      ratingId,
      organizationId,
      fixture.portalId,
      fixture.propertyId,
      fixture.sessionId,
      IP_HASH,
    ],
  )
  await q(
    `INSERT INTO feedback (id, organization_id, portal_id, property_id, rating_id,
                           comment, source, session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'qr', NULL, $7, now())`,
    [
      randomUUID(),
      organizationId,
      fixture.portalId,
      fixture.propertyId,
      ratingId,
      LEGACY_COMMENT,
      IP_HASH,
    ],
  )
  // Permitted contact. Contact Request is dark, so this row cannot lawfully
  // exist in beta; it is seeded so the scrub is proved before activation.
  await q(
    `INSERT INTO guest_contact_requests (
       id, organization_id, property_id, portal_id, response_id,
       publication_snapshot_id, publication_version, publication_digest,
       contact_request_enabled, notice_id, notice_version, notice_digest,
       notice_locale, retention_policy_version, purpose, consent_granted,
       encrypted_contact, encryption_key_id, status, submitted_at, expires_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 2, $7, true, 'guest-contact-notice', 'v1', $8,
               'en', 'guest-contact-retention-30d-v1', 'manager_follow_up', true,
               $9, 'guest-contact-v1', 'active', now() - interval '1 day',
               now() - interval '1 day' + interval '720:00:00', now(), now())`,
    [
      fixture.contactRequestId,
      ...scope,
      fixture.responseId,
      contactSnapshotId,
      DIGEST,
      NOTICE_DIGEST,
      CONTACT_CIPHERTEXT,
    ],
  )
  await q(
    `INSERT INTO guest_contact_request_reveal_audits (
       id, contact_request_id, organization_id, property_id, portal_id, actor_id,
       access_purpose, authority_basis, revealed_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'respond_to_contact_request', 'account_admin',
               now(), now())`,
    [randomUUID(), fixture.contactRequestId, ...scope, actor],
  )
  return fixture
}

async function seedAuthority(
  organizationId: string,
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
    [organizationId, lineage, requestAt, RECOVERABLE_UNTIL],
  )
  if (target === 'closure_requested') return 1

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closing', revision = 2, last_transition_at = $2,
         last_actor_id = 'system:lifecycle', last_reason_code = 'closing_prepared',
         last_support_evidence_ref = 'test:closing-prepared'
     WHERE organization_id = $1`,
    [organizationId, new Date(OCCURRED_AT.getTime() - 4000)],
  )
  if (target === 'closing') return 2

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purge_pending', revision = 3, last_transition_at = $2,
         last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'recovery_window_waived',
         last_support_evidence_ref = 'test:recovery-waived'
     WHERE organization_id = $1`,
    [organizationId, new Date(OCCURRED_AT.getTime() - 3000)],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purging', revision = 4, irreversible_at = $2,
         last_transition_at = $2, last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'irreversible_purge_authorized',
         last_support_evidence_ref = 'test:purge-authorized'
     WHERE organization_id = $1`,
    [organizationId, new Date(OCCURRED_AT.getTime() - 2000)],
  )
  return 4
}

function input(
  organizationId: string,
  lineage: string,
  revision: number,
): OrganizationLifecycleContributionInput {
  return {
    organizationId,
    closureLineageId: lineage,
    lifecycleRevision: revision,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  }
}

async function deleteReceiptFixtures(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       DISABLE TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    await client.query(
      `DELETE FROM context_organization_lifecycle_receipts
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       ENABLE ALWAYS TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
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
  'guest_contact_request_reveal_audits',
  'guest_contact_requests',
  'guest_response_private_feedback',
  'guest_response_session_bindings',
  'guest_response_experience_snapshots',
  'guest_response_integrity_decisions',
  'guest_responses',
  'guest_qualified_scans',
  'guest_network_pressure_records',
  'feedback',
  'ratings',
  'scan_events',
  'outbox_events',
  'portal_metric_lifetime_aggregates',
  'portal_access_artifacts',
  'portal_tokens',
  'portal_publication_snapshots',
  'portals',
  'properties',
] as const

/** Every column that could still hold a seeded secret after the purge. */
async function recoverableSecrets(organizationId: string): Promise<readonly string[]> {
  const probes: ReadonlyArray<readonly [string, string]> = [
    ['guest_response_private_feedback', 'body'],
    ['feedback', 'comment'],
    ['guest_contact_requests', 'encrypted_contact'],
    ['ratings', 'ip_hash'],
    ['scan_events', 'ip_hash'],
    ['guest_network_pressure_records', 'pseudonym'],
  ]
  const found: string[] = []
  for (const [table, column] of probes) {
    const result = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM ${table}
       WHERE organization_id = $1 AND ${column} IS NOT NULL`,
      [organizationId],
    )
    if (Number(result.rows[0]?.count ?? 0) > 0) found.push(`${table}.${column}`)
  }
  return found
}

describe.sequential('Guest Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    await lease.pool.query(
      `DELETE FROM idempotency_receipts
       WHERE scope IN ('guest_qualified_scan', 'guest_destination_action')
         AND payload->>'organizationId' = ANY($1::text[])`,
      [ids],
    )
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

  it('deletes and edits nothing on Closing, and still answers affirmatively', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(
      fixture.organizationId,
      lineage,
      'closure_requested',
    )
    const before = await counts(fixture.organizationId)
    const beforeSecrets = await recoverableSecrets(fixture.organizationId)

    const result = await createGuestOrganizationLifecycleContributor(db).prepareClosing(
      input(fixture.organizationId, lineage, revision),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: `guest:closing:complete:${lineage}:r${revision}`,
    })
    // Closing opens a recoverable window: Guest keeps every row.
    expect(await counts(fixture.organizationId)).toEqual(before)
    expect(await recoverableSecrets(fixture.organizationId)).toEqual(beforeSecrets)

    const receipt = await lease.pool.query(
      `SELECT context, phase, outcome, evidence_ref
       FROM context_organization_lifecycle_receipts WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(receipt.rows).toEqual([
      {
        context: 'guest',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: `guest:closing:complete:${lineage}:r${revision}`,
      },
    ])
  })

  it('answers no_data for an Organization that owns no Guest row', async () => {
    const organizationId = await seedOrganization()
    const lineage = randomUUID()
    const revision = await seedAuthority(organizationId, lineage, 'closure_requested')

    const result = await createGuestOrganizationLifecycleContributor(db).prepareClosing(
      input(organizationId, lineage, revision),
    )

    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef: `guest:closing:no_data:${lineage}:r${revision}`,
    })
  })

  it('blocks readiness until Guest corrections reach the lifetime aggregate, and mutates nothing', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture.organizationId, lineage, 'closing')
    const contributor = createGuestOrganizationLifecycleContributor(db)
    // A withdrawal that has not reached the anonymous lifetime aggregate yet.
    await lease.pool.query(
      `INSERT INTO outbox_events (id, event_type, event_version, payload,
                                  organization_id, source_context,
                                  source_aggregate_id, created_at)
       VALUES ($1, 'guest.private_feedback.withdrawn', 1, '{}'::jsonb, $2, 'guest',
               $3, now())`,
      [randomUUID(), fixture.organizationId, fixture.responseId],
    )
    const before = await counts(fixture.organizationId)

    await expect(
      contributor.verifyPurgeReadiness(input(fixture.organizationId, lineage, revision)),
    ).rejects.toThrow(GUEST_PURGE_READINESS_BLOCKED)

    // Scrubbing now would strand the correction forever, so nothing moved.
    expect(await counts(fixture.organizationId)).toEqual(before)
    const receipts = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(Number(receipts.rows[0]?.count)).toBe(0)

    await lease.pool.query(
      `UPDATE outbox_events SET published_at = now() WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    const beforeSecrets = await recoverableSecrets(fixture.organizationId)

    const result = await contributor.verifyPurgeReadiness(
      input(fixture.organizationId, lineage, revision),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: `guest:purge_readiness:complete:${lineage}:r${revision}`,
    })
    expect(await counts(fixture.organizationId)).toEqual(before)
    expect(await recoverableSecrets(fixture.organizationId)).toEqual(beforeSecrets)
  })

  it('scrubs every guest value while keeping the anonymous aggregate and other tenants', async () => {
    const fixture = await seedFixture()
    const bystander = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture.organizationId, lineage, 'purging')
    const bystanderBefore = await counts(bystander.organizationId)
    const contributor = createGuestOrganizationLifecycleContributor(db)
    expect(await recoverableSecrets(fixture.organizationId)).not.toEqual([])

    const first = await contributor.purge(
      input(fixture.organizationId, lineage, revision),
    )

    expect(first).toEqual({
      outcome: 'complete',
      evidenceRef: `guest:purge:complete:${lineage}:r${revision}`,
    })
    const after = await counts(fixture.organizationId)
    for (const table of GUEST_PURGE_PLAN) {
      expect({ table, rows: after[table] }).toEqual({ table, rows: 0 })
    }
    // Nothing seeded is recoverable from any Guest read path.
    expect(await recoverableSecrets(fixture.organizationId)).toEqual([])
    const literals = await lease.pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM guest_response_private_feedback
          WHERE organization_id = $4 AND body = $1) AS private_text,
         (SELECT COUNT(*)::int FROM feedback
          WHERE organization_id = $4 AND comment = $2) AS legacy_comment,
         (SELECT COUNT(*)::int FROM guest_contact_requests
          WHERE organization_id = $4 AND encrypted_contact = $3) AS contact`,
      [PRIVATE_TEXT, LEGACY_COMMENT, CONTACT_CIPHERTEXT, fixture.organizationId],
    )
    expect(literals.rows[0]).toEqual({
      private_text: 0,
      legacy_comment: 0,
      contact: 0,
    })

    // The anonymous lifetime aggregate the metrics depend on is Metric's row
    // and survives with its counts intact.
    const aggregate = await lease.pool.query(
      `SELECT qualified_scan_count, private_rating_count, private_rating_sum
       FROM portal_metric_lifetime_aggregates WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(aggregate.rows).toEqual([
      { qualified_scan_count: '12', private_rating_count: '1', private_rating_sum: '2' },
    ])

    // The global 30-day retention cursor has no tenant scope and is untouched.
    const checkpoints = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM idempotency_receipts
       WHERE scope = 'guest_contact_purge'`,
    )
    expect(Number(checkpoints.rows[0]?.count)).toBeGreaterThanOrEqual(0)

    // Another owner's rows and another tenant's rows are untouched.
    const foreign = await lease.pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM portals WHERE organization_id = $1) AS portals,
         (SELECT COUNT(*)::int FROM properties WHERE organization_id = $1) AS properties`,
      [fixture.organizationId],
    )
    expect(foreign.rows[0]).toEqual({ portals: 1, properties: 1 })
    expect(await counts(bystander.organizationId)).toEqual(bystanderBefore)
    expect(await recoverableSecrets(bystander.organizationId)).not.toEqual([])

    // Idempotent.
    const replay = await contributor.purge({
      ...input(fixture.organizationId, lineage, revision),
      occurredAt: new Date(OCCURRED_AT.getTime() + 60_000),
    })
    expect(replay).toEqual(first)
    expect(await counts(fixture.organizationId)).toEqual(after)
    const receipts = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND phase = 'purge'`,
      [fixture.organizationId],
    )
    expect(Number(receipts.rows[0]?.count)).toBe(1)
  })

  it('never drops a table or a compatibility mirror', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture.organizationId, lineage, 'purging')

    await createGuestOrganizationLifecycleContributor(db).purge(
      input(fixture.organizationId, lineage, revision),
    )

    const present = await lease.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...GUEST_PURGE_PLAN]],
    )
    expect(present.rows.map((row) => row.table_name).sort()).toEqual(
      [...GUEST_PURGE_PLAN].sort(),
    )
  })
})
