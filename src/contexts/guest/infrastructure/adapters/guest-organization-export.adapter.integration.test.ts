import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createGuestOrganizationExportContributor } from './guest-organization-export.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const DIGEST = 'a'.repeat(64)
const NOTICE_DIGEST = 'b'.repeat(64)
const PSEUDONYM = 'c'.repeat(64)
const LIVE_TEXT = 'The, "room" was cold\nbut the staff were kind'
const EXPIRED_TEXT = 'NEVER_EXPORT_EXPIRED_FEEDBACK_TEXT'
const CONTACT_CIPHERTEXT = 'NEVER_EXPORT_CONTACT_CIPHERTEXT'

// Deleted innermost-first; every Guest foreign key is RESTRICT or CASCADE.
const CHILD_TABLES = [
  'guest_contact_request_reveal_audits',
  'guest_contact_requests',
  'guest_response_session_bindings',
  'guest_response_private_feedback',
  'guest_response_experience_snapshots',
  'guest_response_integrity_decisions',
  'guest_qualified_scans',
  'guest_network_pressure_records',
  'guest_responses',
  'feedback',
  'ratings',
  'scan_events',
  'portal_access_artifacts',
  'portal_tokens',
  'portal_publication_snapshots',
  'portals',
  'properties',
] as const

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  liveTextResponseId: string
  expiredTextResponseId: string
  qualifiedScanId: string
  mappedScanEventId: string
  unmappedScanEventId: string
  unmappedRatingId: string
  unmappedFeedbackId: string
  contactRequestId: string
  revealAuditId: string
  sessionId: string
  destinationSessionId: string
  actorId: string
}>

async function seedOrganization(): Promise<string> {
  const organizationId = `guest-export-org-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Guest Export Fixture', $1, now())`,
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
    liveTextResponseId: randomUUID(),
    expiredTextResponseId: randomUUID(),
    qualifiedScanId: randomUUID(),
    mappedScanEventId: randomUUID(),
    unmappedScanEventId: randomUUID(),
    unmappedRatingId: randomUUID(),
    unmappedFeedbackId: randomUUID(),
    contactRequestId: randomUUID(),
    revealAuditId: randomUUID(),
    sessionId: randomUUID(),
    destinationSessionId: randomUUID(),
    actorId: `guest-export-actor-${randomUUID()}`,
  }
  const q = (text: string, values: readonly unknown[]) =>
    lease.pool.query(text, [...values])
  const scope = [organizationId, fixture.propertyId, fixture.portalId]
  const tokenId = randomUUID()
  const artifactId = randomUUID()
  const factsSnapshotId = randomUUID()
  const contactSnapshotId = randomUUID()

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
        fixture.actorId,
      ],
    )
  await snapshot(factsSnapshotId, 1, false)
  await snapshot(contactSnapshotId, 2, true)
  await q(
    `INSERT INTO portal_tokens (id, organization_id, property_id, portal_id,
                                token_identifier, token_hash, version, status,
                                issued_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', now(), now())`,
    [tokenId, ...scope, randomUUID().replaceAll('-', '').slice(0, 24), 'f'.repeat(64)],
  )
  await q(
    `INSERT INTO portal_access_artifacts (id, organization_id, property_id, portal_id,
                                          portal_token_id, channel, status, published_at)
     VALUES ($1, $2, $3, $4, $5, 'qr', 'published', now())`,
    [artifactId, ...scope, tokenId],
  )

  const response = (id: string, rating: number, feedbackAt: string) =>
    q(
      `INSERT INTO guest_responses (
         id, organization_id, property_id, portal_id, status, rating,
         response_consent, text_consent, private_feedback_threshold,
         correction_count, submitted_at, feedback_submitted_at,
         feedback_submission_revision, retention_deadline, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'submitted', $5, true, true, 3, 0,
                 now() - interval '2 days', ${feedbackAt}, 1,
                 now() + interval '700 days', now() - interval '2 days', now())`,
      [id, ...scope, rating],
    )
  await response(fixture.liveTextResponseId, 2, `now() - interval '2 days'`)
  await response(fixture.expiredTextResponseId, 1, `now() - interval '100 days'`)

  await q(
    `INSERT INTO guest_response_private_feedback (
       response_id, organization_id, property_id, portal_id, body, submitted_at,
       expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, now() - interval '2 days',
               now() + interval '88 days', now())`,
    [fixture.liveTextResponseId, ...scope, LIVE_TEXT],
  )
  // Past its 90-day window: the body must not leave, but the response fact must
  // still say feedback was received.
  await q(
    `INSERT INTO guest_response_private_feedback (
       response_id, organization_id, property_id, portal_id, body, submitted_at,
       expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, now() - interval '100 days',
               now() - interval '10 days', now() - interval '100 days')`,
    [fixture.expiredTextResponseId, ...scope, EXPIRED_TEXT],
  )
  await q(
    `INSERT INTO guest_response_integrity_decisions (
       id, response_id, organization_id, property_id, portal_id, revision, outcome,
       reason_code, source, actor_id, decided_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'accepted', 'legacy_included', 'system', $6,
               now(), now())`,
    [randomUUID(), fixture.liveTextResponseId, ...scope, fixture.actorId],
  )
  await q(
    `INSERT INTO guest_response_experience_snapshots (
       response_id, organization_id, property_id, portal_id, publication_state,
       publication_snapshot_id, publication_version, publication_digest,
       configuration_digest, guest_locale, language_pack_version,
       private_feedback_threshold, captured_at
     ) VALUES ($1, $2, $3, $4, 'published', $5, 1, $6, $6, 'en', 'guest-ui-en-v1', 3,
               now())`,
    [fixture.liveTextResponseId, ...scope, factsSnapshotId, DIGEST],
  )
  await q(
    `INSERT INTO scan_events (id, organization_id, portal_id, property_id, source,
                              session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 'qr', $5, 'NEVER_EXPORT_IP_HASH', now())`,
    [
      fixture.mappedScanEventId,
      organizationId,
      fixture.portalId,
      fixture.propertyId,
      fixture.sessionId,
    ],
  )
  await q(
    `INSERT INTO guest_qualified_scans (
       id, organization_id, property_id, portal_id, access_artifact_id,
       source_event_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [fixture.qualifiedScanId, ...scope, artifactId, fixture.mappedScanEventId],
  )

  // Legacy rows: one already succeeded by a canonical row (must not be
  // double-counted) and one with no successor (must be exported).
  await q(
    `INSERT INTO ratings (id, organization_id, portal_id, property_id, value, source,
                          session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 2, 'qr', NULL, 'NEVER_EXPORT_IP_HASH', now())`,
    [fixture.liveTextResponseId, organizationId, fixture.portalId, fixture.propertyId],
  )
  await q(
    `INSERT INTO ratings (id, organization_id, portal_id, property_id, value, source,
                          session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 4, 'qr', $5, 'NEVER_EXPORT_IP_HASH', now())`,
    [
      fixture.unmappedRatingId,
      organizationId,
      fixture.portalId,
      fixture.propertyId,
      fixture.sessionId,
    ],
  )
  await q(
    `INSERT INTO feedback (id, organization_id, portal_id, property_id, rating_id,
                           comment, source, session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, 'Legacy comment kept for the tenant', 'qr', NULL,
             'NEVER_EXPORT_IP_HASH', now())`,
    [
      fixture.unmappedFeedbackId,
      organizationId,
      fixture.portalId,
      fixture.propertyId,
      fixture.unmappedRatingId,
    ],
  )
  await q(
    `INSERT INTO scan_events (id, organization_id, portal_id, property_id, source,
                              session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 'nfc', NULL, 'NEVER_EXPORT_IP_HASH', now())`,
    [fixture.unmappedScanEventId, organizationId, fixture.portalId, fixture.propertyId],
  )
  // Everything below is deliberately unexportable material.
  await q(
    `INSERT INTO guest_response_session_bindings (
       response_id, organization_id, property_id, portal_id, session_id, expires_at,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', now())`,
    [fixture.liveTextResponseId, ...scope, fixture.sessionId],
  )
  await q(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES
       ('guest_qualified_scan', $1, jsonb_build_object(
         'organizationId', $3::text, 'propertyId', $4::text, 'portalId', $5::text,
         'sessionId', $6::text, 'qualifiedScanId', $7::text
       ), now()),
       ('guest_destination_action', $2, jsonb_build_object(
         'organizationId', $3::text, 'propertyId', $4::text, 'portalId', $5::text,
         'sessionId', $8::text, 'destinationId', 'NEVER_EXPORT_DESTINATION'
       ), now())`,
    [
      randomUUID(),
      randomUUID(),
      organizationId,
      fixture.propertyId,
      fixture.portalId,
      fixture.sessionId,
      fixture.qualifiedScanId,
      fixture.destinationSessionId,
    ],
  )
  await q(
    `INSERT INTO guest_network_pressure_records (
       id, organization_id, property_id, portal_id, pseudonym, action, observed_at,
       expires_at
     ) VALUES ($1, $2, $3, $4, $5, 'rating', now(), now() + interval '7 days')`,
    [randomUUID(), ...scope, PSEUDONYM],
  )
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
      fixture.liveTextResponseId,
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
    [fixture.revealAuditId, fixture.contactRequestId, ...scope, fixture.actorId],
  )
  return fixture
}

describe.sequential('Guest Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query(
        `DELETE FROM idempotency_receipts
         WHERE scope IN ('guest_qualified_scan', 'guest_destination_action')
           AND payload->>'organizationId' = $1`,
        [organizationId],
      )
      for (const table of CHILD_TABLES) {
        // Table names come from the frozen constant above, never from input.
        await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
          organizationId,
        ])
      }
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('exports permitted Guest facts and text, and nothing a session, contact, or abuse control owns', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createGuestOrganizationExportContributor(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'guest',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(
      first.entries.map(({ path, classification }) => [path, classification]),
    ).toEqual([
      ['guest/responses.csv', 'tenant_visible'],
      ['guest/responses.json', 'tenant_visible'],
      ['guest/legacy-responses.csv', 'tenant_visible'],
      ['guest/legacy-responses.json', 'tenant_visible'],
      ['guest/private-feedback.csv', 'permitted_guest_content'],
      ['guest/private-feedback.json', 'permitted_guest_content'],
    ])

    const read = (path: string) =>
      Buffer.from(first.entries.find((entry) => entry.path === path)!.bytes).toString(
        'utf8',
      )
    const facts = JSON.parse(read('guest/responses.json')) as Readonly<{
      responses: readonly Readonly<Record<string, unknown>>[]
      qualifiedScans: readonly Readonly<Record<string, unknown>>[]
      integrityDecisions: readonly Readonly<Record<string, unknown>>[]
      experienceSnapshots: readonly Readonly<Record<string, unknown>>[]
    }>
    expect(facts.responses).toHaveLength(2)
    expect(facts.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.liveTextResponseId,
          rating: 2,
          status: 'submitted',
          private_feedback_state: 'available',
        }),
        // Expired text renders as "expired", never as an empty body.
        expect.objectContaining({
          id: fixture.expiredTextResponseId,
          private_feedback_state: 'expired',
        }),
      ]),
    )
    expect(facts.qualifiedScans.map(({ id }) => id)).toEqual([fixture.qualifiedScanId])
    expect(facts.integrityDecisions).toHaveLength(1)
    expect(facts.experienceSnapshots).toHaveLength(1)

    const text = JSON.parse(read('guest/private-feedback.json')) as Readonly<{
      privateFeedback: readonly Readonly<{ response_id: string; body: string }>[]
      legacyFeedbackText: readonly Readonly<{ id: string; body: string }>[]
    }>
    expect(text.privateFeedback).toEqual([
      expect.objectContaining({
        response_id: fixture.liveTextResponseId,
        body: LIVE_TEXT,
      }),
    ])
    expect(text.legacyFeedbackText).toEqual([
      expect.objectContaining({ id: fixture.unmappedFeedbackId }),
    ])

    const legacy = JSON.parse(read('guest/legacy-responses.json')) as Readonly<{
      legacyRatings: readonly Readonly<{ id: string }>[]
      legacyFeedbackFacts: readonly Readonly<{ id: string }>[]
      legacyScanEvents: readonly Readonly<{ id: string }>[]
    }>
    // The legacy rating sharing a canonical id is already exported as a
    // canonical response; exporting it again would double-count it.
    expect(legacy.legacyRatings.map(({ id }) => id)).toEqual([fixture.unmappedRatingId])
    expect(legacy.legacyFeedbackFacts.map(({ id }) => id)).toEqual([
      fixture.unmappedFeedbackId,
    ])
    expect(legacy.legacyScanEvents.map(({ id }) => id)).toEqual([
      fixture.unmappedScanEventId,
    ])

    const archiveText = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archiveText).not.toContain('NEVER_EXPORT_')
    expect(archiveText).not.toContain(EXPIRED_TEXT)
    expect(archiveText).not.toContain(CONTACT_CIPHERTEXT)
    expect(archiveText).not.toContain(fixture.contactRequestId)
    expect(archiveText).not.toContain(fixture.revealAuditId)
    expect(archiveText).not.toContain(fixture.sessionId)
    expect(archiveText).not.toContain(fixture.destinationSessionId)
    expect(archiveText).not.toContain(PSEUDONYM)
    expect(archiveText).not.toMatch(/session_id|ip_hash|encrypted_contact/u)
  })

  it('places the whole contribution inside a valid bundle without a contact entry', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'guest'
          ? createGuestOrganizationExportContributor(db)
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })

    const guestEntries = bundle.entries.filter(({ path }) => path.startsWith('guest/'))
    expect(guestEntries.map(({ path }) => path)).toEqual([
      'guest/legacy-responses.csv',
      'guest/legacy-responses.json',
      'guest/private-feedback.csv',
      'guest/private-feedback.json',
      'guest/responses.csv',
      'guest/responses.json',
    ])
    // Contact Request stays dark: no path, no bytes, no manifest row.
    expect(bundle.entries.some(({ path }) => /contact/u.test(path))).toBe(false)
    expect(bundle.manifest.entries.some(({ path }) => /contact/u.test(path))).toBe(false)
    const coverage = bundle.entries.find(({ path }) => path === 'coverage.json')!
    expect(Buffer.from(coverage.bytes).toString('utf8')).not.toContain(
      fixture.contactRequestId,
    )
  })

  it('answers no_data for an Organization with no Guest rows', async () => {
    const organizationId = await seedOrganization()

    const contribution = await createGuestOrganizationExportContributor(db).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'guest',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })
})
