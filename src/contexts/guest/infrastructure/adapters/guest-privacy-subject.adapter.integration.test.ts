// LIF-01-T20 — Guest privacy subject resolution against real PostgreSQL.
//
// The claims a privacy reviewer has to be able to check:
//   * resolution is bound to a VERIFIED subject identifier, and a cross-tenant
//     or cross-property lookup is refused rather than answered emptily;
//   * an access package carries the subject's own rows and no secrets;
//   * a withdrawal leaves a minimal, honest tombstone rather than a 404;
//   * an erasure removes feedback text, permitted contact and the reveal audits
//     for that contact, while the content-free response fact survives.
//
// An outer transaction always rolls the proof back.

import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import type { PrivacySubjectScope } from '#/shared/ops/privacy/privacy-subject-contributor.port'
import type { Tx } from '#/shared/outbox/commit'
import { createGuestPrivacySubjectContributor } from './guest-privacy-subject.adapter'

const db = getDb()
const ROLLBACK = new Error('rollback guest privacy subject integration proof')
const contributor = createGuestPrivacySubjectContributor()

const PRIVATE_TEXT = 'NEVER_SURVIVE_PRIVACY_FEEDBACK_BODY'
const CONTACT_CIPHERTEXT = 'NEVER_SURVIVE_PRIVACY_CONTACT_CIPHERTEXT'
const DIGEST = 'a'.repeat(64)
const NOTICE_DIGEST = 'b'.repeat(64)

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  otherPropertyId: string
  portalId: string
  responseId: string
  contactRequestId: string
  sessionId: string
  subjectRef: string
}>

async function seed(tx: Tx): Promise<Fixture> {
  const organizationId = `privacy-org-${randomUUID()}`
  const sessionId = randomUUID()
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    otherPropertyId: randomUUID(),
    portalId: randomUUID(),
    responseId: randomUUID(),
    contactRequestId: randomUUID(),
    sessionId,
    subjectRef: sha256(sessionId),
  }
  await tx.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, 'Privacy Proof', ${organizationId}, clock_timestamp())
  `)
  for (const id of [fixture.propertyId, fixture.otherPropertyId]) {
    await tx.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone,
                              created_at, updated_at)
      VALUES (${id}::uuid, ${organizationId}, 'Privacy House', ${`privacy-${id}`},
              'UTC', clock_timestamp(), clock_timestamp())
    `)
  }
  await tx.execute(sql`
    INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                         publication_state, created_at, updated_at)
    VALUES (${fixture.portalId}::uuid, ${organizationId}, ${fixture.propertyId}::uuid,
            ${fixture.propertyId}::uuid, 'Front Desk', ${`portal-${fixture.portalId}`},
            'published', clock_timestamp(), clock_timestamp())
  `)
  const snapshotId = randomUUID()
  await tx.execute(sql`
    INSERT INTO portal_publication_snapshots (
      id, organization_id, property_id, portal_id, version, configuration_digest,
      configuration, guest_locale, language_pack_version, private_feedback_threshold,
      contact_request_enabled, contact_notice_id, contact_notice_version,
      contact_notice_digest, contact_notice_locale, destination_uri,
      destination_retrieved_at, destination_source_epoch,
      destination_profile_version, created_by, created_at
    ) VALUES (
      ${snapshotId}::uuid, ${organizationId}, ${fixture.propertyId}::uuid,
      ${fixture.portalId}::uuid, 1, ${DIGEST}, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
      true, 'guest-contact-notice', 'v1', ${NOTICE_DIGEST}, 'en',
      'https://example.test/review', clock_timestamp(), 0, 1,
      'privacy-proof-actor', clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_responses (
      id, organization_id, property_id, portal_id, status, rating,
      response_consent, text_consent, private_feedback_threshold,
      correction_count, submitted_at, feedback_submitted_at,
      feedback_submission_revision, retention_deadline, created_at, updated_at
    ) VALUES (
      ${fixture.responseId}::uuid, ${organizationId}, ${fixture.propertyId}::uuid,
      ${fixture.portalId}::uuid, 'submitted', 2, true, true, 3, 0,
      clock_timestamp(), clock_timestamp(), 1,
      clock_timestamp() + interval '700 days', clock_timestamp(), clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_response_session_bindings (
      response_id, organization_id, property_id, portal_id, session_id, expires_at,
      created_at
    ) VALUES (
      ${fixture.responseId}::uuid, ${organizationId}, ${fixture.propertyId}::uuid,
      ${fixture.portalId}::uuid, ${sessionId}::uuid,
      clock_timestamp() + interval '1 day', clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_response_private_feedback (
      response_id, organization_id, property_id, portal_id, body, submitted_at,
      expires_at, created_at
    ) VALUES (
      ${fixture.responseId}::uuid, ${organizationId}, ${fixture.propertyId}::uuid,
      ${fixture.portalId}::uuid, ${PRIVATE_TEXT}, clock_timestamp(),
      clock_timestamp() + interval '88 days', clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_contact_requests (
      id, organization_id, property_id, portal_id, response_id,
      publication_snapshot_id, publication_version, publication_digest,
      contact_request_enabled, notice_id, notice_version, notice_digest,
      notice_locale, retention_policy_version, purpose, consent_granted,
      encrypted_contact, encryption_key_id, status, submitted_at, expires_at,
      created_at, updated_at
    ) VALUES (
      ${fixture.contactRequestId}::uuid, ${organizationId}, ${fixture.propertyId}::uuid,
      ${fixture.portalId}::uuid, ${fixture.responseId}::uuid, ${snapshotId}::uuid, 1,
      ${DIGEST}, true, 'guest-contact-notice', 'v1', ${NOTICE_DIGEST}, 'en',
      'guest-contact-retention-30d-v1', 'manager_follow_up', true,
      -- now(), not clock_timestamp(). The table carries
      -- guest_contact_requests_retention_exact:
      --   CHECK (expires_at = submitted_at + '720:00:00'::interval)
      -- and clock_timestamp() ADVANCES within a transaction, so reading it
      -- separately for submitted_at and expires_at made the two disagree by
      -- however long the row took to build. It passed whenever those reads
      -- landed in the same microsecond and failed under load, which is what
      -- made this look like test-ordering flake in CI. now() is the
      -- transaction timestamp and is stable, so the pair is equal by
      -- construction.
      ${CONTACT_CIPHERTEXT}, 'guest-contact-v1', 'active', now(),
      now() + interval '30 days', now(), now()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_contact_request_reveal_audits (
      id, contact_request_id, organization_id, property_id, portal_id, actor_id,
      access_purpose, authority_basis, revealed_at, created_at
    ) VALUES (
      gen_random_uuid(), ${fixture.contactRequestId}::uuid, ${organizationId},
      ${fixture.propertyId}::uuid, ${fixture.portalId}::uuid, 'privacy-proof-actor',
      'respond_to_contact_request', 'account_admin', clock_timestamp(), clock_timestamp()
    )
  `)
  return fixture
}

const scopeOf = (fixture: Fixture): PrivacySubjectScope => ({
  organizationId: fixture.organizationId,
  propertyId: fixture.propertyId,
  subjectType: 'guest',
  subjectRef: fixture.subjectRef,
})

async function count(tx: Tx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  return Number((result.rows[0] as { rows: number | string }).rows)
}

describe('guest privacy subject adapter (LIF-01-T20)', () => {
  it('binds resolution to a verified subject identifier', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const scope = scopeOf(fixture)

        expect(await contributor.resolve(tx, scope)).toBe(true)
        // An unverified guess at the session id resolves to nothing.
        expect(
          await contributor.resolve(tx, { ...scope, subjectRef: sha256(randomUUID()) }),
        ).toBe(false)
        // Participant subjects are Staff's, not Guest's.
        expect(
          await contributor.resolve(tx, { ...scope, subjectType: 'participant' }),
        ).toBe(false)

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('refuses a cross-tenant or cross-property lookup', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const scope = scopeOf(fixture)

        for (const wrong of [
          { ...scope, organizationId: `privacy-org-${randomUUID()}` },
          { ...scope, propertyId: fixture.otherPropertyId },
        ]) {
          expect(await contributor.resolve(tx, wrong)).toBe(false)
          // And no data leaks even if resolution were skipped.
          const sections = await contributor.access(tx, wrong)
          expect(sections.flatMap((section) => section.records)).toEqual([])
          expect((await contributor.erase(tx, wrong)).affected).toBe(0)
        }

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('returns the subject own rows and no secrets', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const sections = await contributor.access(tx, scopeOf(fixture))

        expect(sections.map((section) => section.table)).toEqual([
          'guest_responses',
          'guest_response_private_feedback',
          'guest_contact_requests',
        ])
        const serialized = JSON.stringify(sections)
        expect(serialized).toContain(PRIVATE_TEXT)
        // The contact ciphertext and its key id are secrets. A privacy export
        // must never widen access to them.
        expect(serialized).not.toContain(CONTACT_CIPHERTEXT)
        expect(serialized).not.toContain('guest-contact-v1')
        expect(sections.find((s) => s.table === 'guest_responses')?.classification).toBe(
          'personal',
        )

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('withdraws to a minimal, honest tombstone', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const result = await contributor.withdraw(tx, scopeOf(fixture))
        expect(result.affected).toBeGreaterThanOrEqual(2)

        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_response_private_feedback
                WHERE body = ${PRIVATE_TEXT}`,
          ),
        ).toBe(0)
        // The response row survives so a notification deep link resolves to an
        // honest withdrawn state instead of vanishing.
        const row = await tx.execute(sql`
          SELECT status, rating, text_consent, feedback_withdrawn_at IS NOT NULL AS withdrawn
          FROM guest_responses WHERE id = ${fixture.responseId}::uuid
        `)
        expect(row.rows[0]).toMatchObject({
          status: 'corrected',
          rating: null,
          text_consent: false,
          withdrawn: true,
        })

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('erases feedback, contact and reveal audits while the content-free fact survives', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const result = await contributor.erase(tx, scopeOf(fixture))
        expect(result.affected).toBeGreaterThanOrEqual(4)

        for (const [table, predicate] of [
          [
            'guest_response_private_feedback',
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_response_private_feedback
                WHERE body = ${PRIVATE_TEXT}`,
          ],
          [
            'guest_contact_requests',
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_contact_requests
                WHERE encrypted_contact = ${CONTACT_CIPHERTEXT}`,
          ],
          [
            'guest_contact_request_reveal_audits',
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_contact_request_reveal_audits
                WHERE contact_request_id = ${fixture.contactRequestId}::uuid`,
          ],
        ] as const) {
          expect(await count(tx, predicate), table).toBe(0)
        }

        // The content-free guest_responses fact survives so the anonymous
        // lifetime aggregate stays rebuildable.
        const row = await tx.execute(sql`
          SELECT rating, text_consent, deleted_at FROM guest_responses
          WHERE id = ${fixture.responseId}::uuid
        `)
        // The fact stays — and stays undeleted — so the anonymous lifetime
        // aggregate remains rebuildable after the content is gone.
        expect(row.rows[0]).toMatchObject({
          rating: null,
          text_consent: false,
          deleted_at: null,
        })

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })

  it('corrects only the named field and refuses anything else', async () => {
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as Tx
        const fixture = await seed(tx)
        const scope = scopeOf(fixture)

        await contributor.correct(tx, { scope, field: 'rating', value: 5 })
        const row = await tx.execute(sql`
          SELECT rating, correction_count, corrected_at IS NOT NULL AS corrected
          FROM guest_responses WHERE id = ${fixture.responseId}::uuid
        `)
        expect(row.rows[0]).toMatchObject({ rating: 5, corrected: true })
        // The feedback body is untouched by a rating correction.
        expect(
          await count(
            tx,
            sql`SELECT COUNT(*)::int AS "rows" FROM guest_response_private_feedback
                WHERE body = ${PRIVATE_TEXT}`,
          ),
        ).toBe(1)

        await expect(
          contributor.correct(tx, { scope, field: 'status', value: 'submitted' }),
        ).rejects.toMatchObject({ code: 'subject_content_in_record' })

        throw ROLLBACK
      }),
    ).rejects.toBe(ROLLBACK)
  })
})
