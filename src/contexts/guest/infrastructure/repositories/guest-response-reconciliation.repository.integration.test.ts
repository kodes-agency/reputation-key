import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { canonicalGuestResponseReconciliationReport } from '../../application/guest-response-reconciliation'
import { buildGuestResponseReconciliationReportFromDatabase } from './guest-response-reconciliation.repository'

const ORG = 'org-guest-response-reconciliation'
const OTHER_ORG = 'org-guest-response-reconciliation-other'
const PROPERTY = 'cf000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = 'cf000000-0000-4000-8000-000000000002'
const PORTAL = 'cf000000-0000-4000-8000-000000000003'
const OTHER_PORTAL = 'cf000000-0000-4000-8000-000000000004'
const LEGACY_RATING = 'cf000000-0000-4000-8000-000000000005'
const LEGACY_FEEDBACK = 'cf000000-0000-4000-8000-000000000006'
const ORPHAN_FEEDBACK = 'cf000000-0000-4000-8000-000000000007'
const OLD_RATING = 'cf000000-0000-4000-8000-000000000008'
const RESPONSE = 'cf000000-0000-4000-8000-000000000009'
const RATING_EVENT = 'cf000000-0000-4000-8000-000000000010'
const FEEDBACK_EVENT = 'cf000000-0000-4000-8000-000000000011'
const MEDIA = 'cf000000-0000-4000-8000-000000000012'
const PUBLICATION = 'cf000000-0000-4000-8000-000000000013'
const CONTACT_RESPONSE = 'cf000000-0000-4000-8000-000000000014'
const CONTACT_RATING_EVENT = 'cf000000-0000-4000-8000-000000000015'
const CONTACT = 'cf000000-0000-4000-8000-000000000016'
const OTHER_RATING = 'cf000000-0000-4000-8000-000000000017'
const SESSION = 'cf000000-0000-4000-8000-000000000018'
const CONTACT_SESSION = 'cf000000-0000-4000-8000-000000000019'
const CORRECTIONLESS_RATING_EVENT = 'cf000000-0000-4000-8000-000000000020'
const CORRECTIONLESS_FEEDBACK_EVENT = 'cf000000-0000-4000-8000-000000000021'
const INVALID_FACT = 'cf000000-0000-4000-8000-000000000022'
const OBSERVED_AT = new Date('2026-08-27T12:00:00.000Z')
const RECENT = new Date('2026-08-27T11:30:00.000Z')
const OLD = new Date('2026-08-25T11:30:00.000Z')

let pool: Pool

async function removeFixtures(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = ANY($1)', [
    [ORG, OTHER_ORG],
  ])
  for (const table of [
    'guest_contact_request_reveal_audits',
    'guest_contact_requests',
    'guest_response_media',
    'guest_response_private_feedback',
    'guest_response_session_bindings',
    'guest_response_experience_snapshots',
    'guest_response_integrity_decisions',
    'guest_responses',
    'feedback',
    'ratings',
    'outbox_events',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
      [ORG, OTHER_ORG],
    ])
  }
  await pool.query(
    'DELETE FROM portal_publication_snapshots WHERE organization_id = ANY($1)',
    [[ORG, OTHER_ORG]],
  )
  await pool.query('DELETE FROM portals WHERE organization_id = ANY($1)', [
    [ORG, OTHER_ORG],
  ])
  await pool.query('DELETE FROM properties WHERE organization_id = ANY($1)', [
    [ORG, OTHER_ORG],
  ])
  await deleteTestOrganizations(pool, [ORG, OTHER_ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await removeFixtures()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Guest reconciliation', $1, $3),
            ($2, 'Guest reconciliation other', $2, $3)`,
    [ORG, OTHER_ORG, OLD],
  )
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Guest property', 'guest-reconciliation', 'UTC', $5, $5),
            ($2, $4, 'Other property', 'guest-reconciliation-other', 'UTC', $5, $5)`,
    [PROPERTY, OTHER_PROPERTY, ORG, OTHER_ORG, OLD],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        created_by, created_at, updated_at)
     VALUES ($1, $3, $5::uuid, 'property', $5::uuid::text, 'Guest portal',
             'guest-reconciliation', 'operator-a', $7, $7),
            ($2, $4, $6::uuid, 'property', $6::uuid::text, 'Other portal',
             'guest-reconciliation-other', 'operator-b', $7, $7)`,
    [PORTAL, OTHER_PORTAL, ORG, OTHER_ORG, PROPERTY, OTHER_PROPERTY, OLD],
  )
  await pool.query(
    `INSERT INTO portal_publication_snapshots
       (id, organization_id, property_id, portal_id, version,
        configuration_digest, configuration, guest_locale,
        language_pack_version, locale_set, language_pack_versions,
        localized_content, private_feedback_threshold, contact_request_enabled,
        contact_notice_id, contact_notice_version, contact_notice_digest,
        contact_notice_locale, destination_uri, destination_retrieved_at,
        destination_source_epoch, destination_profile_version, created_by, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1',
             '["en"]'::jsonb, '{"en":"guest-ui-en-v1"}'::jsonb, '{}'::jsonb,
             3, true, 'contact-notice', 'v1', $6, 'en',
             'https://maps.google.com/?cid=1', $7, 1, 1, 'operator-a', $7)`,
    [PUBLICATION, ORG, PROPERTY, PORTAL, 'a'.repeat(64), 'b'.repeat(64), OLD],
  )
  await pool.query(
    `INSERT INTO ratings
       (id, organization_id, portal_id, property_id, session_id, value, source,
        ip_hash, created_at)
     VALUES ($1, $4, $5, $6, $7, 5, 'qr', NULL, $9),
            ($2, $4, $5, $6, 'old-session', 2, 'direct', 'legacy-hash', $8),
            ($3, $10, $11, $12, NULL, 1, 'direct', NULL, $9)`,
    [
      LEGACY_RATING,
      OLD_RATING,
      OTHER_RATING,
      ORG,
      PORTAL,
      PROPERTY,
      SESSION,
      OLD,
      RECENT,
      OTHER_ORG,
      OTHER_PORTAL,
      OTHER_PROPERTY,
    ],
  )
  await pool.query(
    `INSERT INTO feedback
       (id, organization_id, portal_id, property_id, session_id, rating_id,
        comment, source, created_at)
     VALUES ($1, $3, $4, $5, $6, $2, 'private legacy text', 'qr', $7),
            ($8, $3, $4, $5, NULL, NULL, 'orphan private text', 'direct', $7)`,
    [
      LEGACY_FEEDBACK,
      LEGACY_RATING,
      ORG,
      PORTAL,
      PROPERTY,
      SESSION,
      RECENT,
      ORPHAN_FEEDBACK,
    ],
  )
  await pool.query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status,
        integrity_outcome, integrity_reason_code, integrity_revision,
        integrity_assessed_at, rating, response_consent, text_consent,
        private_feedback_threshold, rating_source_event_id,
        feedback_source_event_id, submitted_at, feedback_submitted_at,
        feedback_submission_revision, retention_deadline, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'submitted', 'accepted', 'submitted', 1,
             $5::timestamptz, 4, true, true, NULL, $6, $7,
             $5::timestamptz, $5::timestamptz, 1,
             $5::timestamptz + INTERVAL '24 months', $5::timestamptz,
             $5::timestamptz),
            ($8, $2, $3, $4, 'submitted', 'accepted', 'submitted', 1,
             $5::timestamptz, 3, true, false, 2, $9, NULL,
             $5::timestamptz, NULL, NULL,
             $5::timestamptz + INTERVAL '24 months', $5::timestamptz,
             $5::timestamptz)`,
    [
      RESPONSE,
      ORG,
      PROPERTY,
      PORTAL,
      RECENT,
      RATING_EVENT,
      FEEDBACK_EVENT,
      CONTACT_RESPONSE,
      CONTACT_RATING_EVENT,
    ],
  )
  await pool.query(
    `INSERT INTO guest_response_session_bindings
       (response_id, organization_id, property_id, portal_id, session_id,
        expires_at, created_at)
     VALUES ($1, $3, $4, $5, $6,
             $7::timestamptz + INTERVAL '24 hours', $7::timestamptz),
            ($2, $3, $4, $5, $8,
             $7::timestamptz + INTERVAL '24 hours', $7::timestamptz)`,
    [RESPONSE, CONTACT_RESPONSE, ORG, PROPERTY, PORTAL, SESSION, RECENT, CONTACT_SESSION],
  )
  await pool.query(
    `INSERT INTO guest_response_private_feedback
       (response_id, organization_id, property_id, portal_id, body,
        submitted_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'canonical private text', $5::timestamptz,
             $5::timestamptz + INTERVAL '90 days', $5::timestamptz)`,
    [RESPONSE, ORG, PROPERTY, PORTAL, RECENT],
  )
  await pool.query(
    `INSERT INTO guest_response_experience_snapshots
       (response_id, organization_id, property_id, portal_id, publication_state,
        publication_snapshot_id, publication_version, publication_digest,
        configuration_digest, guest_locale, language_pack_version,
        private_feedback_threshold, captured_at)
     VALUES ($1, $3, $4, $5, 'published', NULL, NULL, NULL, $6,
             'en', 'guest-ui-en-v1', 3, $7),
            ($2, $3, $4, $5, 'published', $8, 1, $6, $6,
             'en', 'guest-ui-en-v1', 2, $7)`,
    [
      RESPONSE,
      CONTACT_RESPONSE,
      ORG,
      PROPERTY,
      PORTAL,
      'a'.repeat(64),
      RECENT,
      PUBLICATION,
    ],
  )
  await pool.query(
    `INSERT INTO guest_response_integrity_decisions
       (response_id, organization_id, property_id, portal_id, revision,
        previous_outcome, outcome, reason_code, source, actor_id, decided_at,
        created_at)
     VALUES ($1, $2, $3, $4, 1, NULL, 'accepted', 'submitted', 'system',
             'guest-integrity-v1', $5, $5)`,
    [CONTACT_RESPONSE, ORG, PROPERTY, PORTAL, RECENT],
  )
  for (const event of [
    [RATING_EVENT, RESPONSE, 4, 'guest.rating.submitted', null, null],
    [FEEDBACK_EVENT, RESPONSE, null, 'guest.feedback.submitted', null, 1],
    [CONTACT_RATING_EVENT, CONTACT_RESPONSE, 3, 'guest.rating.submitted', null, null],
    [CORRECTIONLESS_RATING_EVENT, RESPONSE, 4, 'guest.rating.submitted', null, null],
    [CORRECTIONLESS_FEEDBACK_EVENT, RESPONSE, null, 'guest.feedback.submitted', null, 1],
  ] as const) {
    const [eventId, responseId, star, eventType, supersedes, revision] = event
    const payload = {
      ...(eventType === 'guest.rating.submitted'
        ? { ratingId: responseId, value: star }
        : { feedbackId: responseId, ratingId: responseId }),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: supersedes,
      ...(revision === null ? {} : { responseRevision: revision }),
      ...(eventId === RATING_EVENT ? {} : { staffAttribution: null }),
      occurredAt: RECENT.toISOString(),
    }
    await pool.query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'guest', $7, $8)`,
      [
        eventId,
        eventType,
        eventId === RATING_EVENT ? 1 : eventType === 'guest.feedback.submitted' ? 3 : 2,
        JSON.stringify(payload),
        ORG,
        PROPERTY,
        responseId,
        RECENT,
      ],
    )
  }
  await pool.query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at)
     VALUES ($1, 'guest.rating.submitted', 2, $2::jsonb, $3, $4,
             'guest', 'private-source-aggregate', $5)`,
    [
      INVALID_FACT,
      JSON.stringify({
        ratingId: RESPONSE,
        organizationId: ORG,
        propertyId: PROPERTY,
        value: 8,
        staffAttribution: null,
        comment: 'private-response-text',
      }),
      ORG,
      PROPERTY,
      RECENT,
    ],
  )
  await pool.query(
    `INSERT INTO guest_response_media
       (id, organization_id, property_id, portal_id, response_id, session_id,
        object_key, content_type, declared_size_bytes, status, expires_at,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'private/do-not-report.jpg',
             'image/jpeg', 100, 'issued',
             $7::timestamptz + INTERVAL '1 hour', $7::timestamptz,
             $7::timestamptz)`,
    [MEDIA, ORG, PROPERTY, PORTAL, RESPONSE, SESSION, RECENT],
  )
  await pool.query(
    `INSERT INTO guest_contact_requests
       (id, organization_id, property_id, portal_id, response_id,
        publication_snapshot_id, publication_version, publication_digest,
        contact_request_enabled, notice_id, notice_version, notice_digest,
        notice_locale, retention_policy_version, purpose, consent_granted,
        encrypted_contact, encryption_key_id, status, submitted_at, expires_at,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, true, 'contact-notice', 'v1',
             $8, 'en', 'guest-contact-retention-30d-v1', 'manager_follow_up',
             true, 'ciphertext-never-report', 'guest-contact-v1', 'active',
             $9::timestamptz, $9::timestamptz + INTERVAL '30 days',
             $9::timestamptz, $9::timestamptz)`,
    [
      CONTACT,
      ORG,
      PROPERTY,
      PORTAL,
      CONTACT_RESPONSE,
      PUBLICATION,
      'a'.repeat(64),
      'b'.repeat(64),
      RECENT,
    ],
  )
})

afterAll(async () => {
  await removeFixtures()
  await pool.end()
})

describe.sequential('Guest Response reconciliation repository', () => {
  it('reports deterministic identifier-only classifications, gaps, facts, and stars', async () => {
    const input = { observedAt: OBSERVED_AT, organizationIds: [ORG] }
    const first = await buildGuestResponseReconciliationReportFromDatabase(getDb(), input)
    const second = await buildGuestResponseReconciliationReportFromDatabase(
      getDb(),
      input,
    )

    expect(second).toEqual(first)
    expect(first.scope).toEqual({ kind: 'organizations', organizationIds: [ORG] })
    expect(first.counts.byReason).toMatchObject({
      legacy_rating_can_map: 2,
      legacy_feedback_can_map_by_rating_id: 1,
      legacy_feedback_without_rating: 1,
      legacy_experience_snapshot_unknown: 2,
      legacy_active_session_duplicate: 1,
      canonical_active_session_duplicate: 1,
      legacy_network_pseudonym_retained: 1,
      legacy_session_retention_overdue: 1,
      canonical_publication_snapshot_unknown: 1,
      canonical_threshold_snapshot_unknown: 1,
      canonical_threshold_snapshot_conflict: 1,
      canonical_integrity_history_missing: 1,
      canonical_rating_source_conflict: 1,
      canonical_feedback_correction_identity_missing: 1,
      canonical_media_active_while_beta_blocked: 1,
      canonical_contact_active_while_beta_blocked: 1,
      canonical_inbox_link_missing: 1,
      legacy_inbox_link_missing: 2,
      canonical_fact_evidence_exact: 4,
      canonical_fact_staff_attribution_unknown: 1,
      canonical_fact_payload_invalid: 1,
    })
    expect(first.ratingDistributions).toMatchObject({
      legacyRatings: { two: 1, five: 1, total: 2 },
      canonicalRetainedRatings: { three: 1, four: 1, total: 2 },
      canonicalEffectiveRatings: { three: 1, four: 1, total: 2 },
      durableRatingFactHeads: { three: 1, four: 1, total: 2 },
    })
    expect(first.facts.map((fact) => fact.eventId)).toEqual([
      RATING_EVENT,
      FEEDBACK_EVENT,
      CONTACT_RATING_EVENT,
      CORRECTIONLESS_RATING_EVENT,
      CORRECTIONLESS_FEEDBACK_EVENT,
    ])
    expect(first.rows.every((row) => row.organizationId === ORG)).toBe(true)

    const serialized = canonicalGuestResponseReconciliationReport(first)
    for (const forbidden of [
      'private legacy text',
      'orphan private text',
      'canonical private text',
      'private/do-not-report.jpg',
      'ciphertext-never-report',
      'legacy-hash',
      'private-response-text',
      'private-source-aggregate',
      SESSION,
      CONTACT_SESSION,
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('honors Organization scope without manufacturing cross-tenant parity', async () => {
    const report = await buildGuestResponseReconciliationReportFromDatabase(getDb(), {
      observedAt: OBSERVED_AT,
      organizationIds: [OTHER_ORG],
    })

    expect(report.rows.every((row) => row.organizationId === OTHER_ORG)).toBe(true)
    expect(report.ratingDistributions.legacyRatings).toMatchObject({
      one: 1,
      total: 1,
    })
    expect(report.ratingDistributions.canonicalRetainedRatings.total).toBe(0)
  })
})
