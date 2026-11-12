// What staff may read of a guest response from the inbox (real PG): the two
// shared fields only, each withheld without its consent, never across
// organisations, and the consent-aware content search returns every match.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  guestResponseId,
  guestSessionId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { createGuestResponseRepository } from './guest-response.repository.server'

const db = getDb()
const NOW = new Date('2026-09-15T12:00:00.000Z')
const unique = randomUUID()
const ORG = `org-snippets-${unique}`
const OTHER_ORG = `org-snippets-other-${unique}`
const PROPERTY = randomUUID()
const PORTAL = randomUUID()
const OTHER_PROPERTY = randomUUID()
const OTHER_PORTAL = randomUUID()
const BULK = 1_001

type Seed = Readonly<{
  org?: string
  rating?: number
  responseConsent?: boolean
  textConsent?: boolean
  status?: 'submitted' | 'moderated'
  deleted?: boolean
  comment?: string
  feedbackExpiresAt?: Date
}>

async function seedResponse(seed: Seed): Promise<string> {
  const id = randomUUID()
  const org = seed.org ?? ORG
  const property = org === ORG ? PROPERTY : OTHER_PROPERTY
  const portal = org === ORG ? PORTAL : OTHER_PORTAL
  await db.execute(sql`
    INSERT INTO guest_responses (
      id, organization_id, property_id, portal_id, status, rating,
      response_consent, text_consent, submitted_at, deleted_at, retention_deadline
    ) VALUES (
      ${id}::uuid, ${org}, ${property}, ${portal}, ${seed.status ?? 'submitted'},
      ${seed.rating ?? 5}, ${seed.responseConsent ?? true}, ${seed.textConsent ?? true},
      ${NOW}, ${seed.deleted ? NOW : null}, ${NOW}::timestamptz + interval '24 months'
    )
  `)
  if (seed.comment !== undefined) {
    const expiresAt = seed.feedbackExpiresAt ?? new Date(NOW.getTime() + 86_400_000)
    await db.execute(sql`
      INSERT INTO guest_response_private_feedback (
        response_id, organization_id, property_id, portal_id, body, submitted_at,
        expires_at
      ) VALUES (${id}::uuid, ${org}, ${property}, ${portal}, ${seed.comment},
        ${new Date(NOW.getTime() - 60_000)}, ${expiresAt})
    `)
  }
  return id
}

async function cleanup() {
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(
      sql`DELETE FROM guest_response_private_feedback WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM portals WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
}

beforeAll(async () => {
  for (const [org, property, portal] of [
    [ORG, PROPERTY, PORTAL],
    [OTHER_ORG, OTHER_PROPERTY, OTHER_PORTAL],
  ] as const) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${org}, ${org}, ${org}, now())
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone)
      VALUES (${property}, ${org}, ${org}, ${org}, 'UTC')
    `)
    await db.execute(sql`
      INSERT INTO portals (
        id, organization_id, property_id, entity_type, entity_id, name, slug,
        publication_state
      ) VALUES (${portal}, ${org}, ${property}, 'property', ${property},
        ${`portal-${portal}`}, ${`portal-${portal}`}, 'published')
    `)
  }
})

afterAll(cleanup)

const repository = () => createGuestResponseRepository(db, () => NOW)

describe('guest response snippets for the inbox', () => {
  it('shares the comment and the rating only where each is consented', async () => {
    const both = await seedResponse({ comment: 'Helpful staff', rating: 4 })
    const ratingOnly = await seedResponse({
      comment: 'Private comment',
      rating: 5,
      textConsent: false,
    })
    const textOnly = await seedResponse({
      comment: 'Shared comment',
      rating: 2,
      responseConsent: false,
    })

    const snippets = await repository().findSnippetsForOrg(
      organizationId(ORG),
      [both, ratingOnly, textOnly].map(guestResponseId),
    )

    expect(snippets).toHaveLength(3)
    expect(snippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: both, comment: 'Helpful staff', ratingValue: 4 }),
        expect.objectContaining({ id: ratingOnly, comment: null, ratingValue: 5 }),
        expect.objectContaining({
          id: textOnly,
          comment: 'Shared comment',
          ratingValue: null,
        }),
      ]),
    )
  })

  it('withholds the comment of a moderated response, and of one past its feedback expiry', async () => {
    const moderated = await seedResponse({
      comment: 'Moderated words',
      status: 'moderated',
    })
    const expired = await seedResponse({
      comment: 'Expired words',
      feedbackExpiresAt: new Date(NOW.getTime() + 1_000),
    })
    const later = createGuestResponseRepository(db, () => new Date(NOW.getTime() + 2_000))

    const now = await repository().findSnippetsForOrg(
      organizationId(ORG),
      [moderated, expired].map(guestResponseId),
    )
    const afterExpiry = await later.findSnippetsForOrg(
      organizationId(ORG),
      [expired].map(guestResponseId),
    )

    expect(now).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: moderated, comment: null }),
        expect.objectContaining({ id: expired, comment: 'Expired words' }),
      ]),
    )
    expect(afterExpiry).toEqual([expect.objectContaining({ id: expired, comment: null })])
  })

  it('never reads another organisation or a deleted response', async () => {
    const foreign = await seedResponse({ org: OTHER_ORG, comment: 'Foreign words' })
    const deleted = await seedResponse({ comment: 'Deleted words', deleted: true })

    await expect(
      repository().findSnippetsForOrg(
        organizationId(ORG),
        [foreign, deleted].map(guestResponseId),
      ),
    ).resolves.toEqual([])
    await expect(
      repository().findSnippetsForOrg(organizationId(ORG), []),
    ).resolves.toEqual([])
  })

  it('returns every id matched by the consent-aware content search, with no page cap', async () => {
    const marker = `breakfast-${unique.slice(0, 8)}`
    await db.execute(sql`
      INSERT INTO guest_responses (
        id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, submitted_at, retention_deadline
      )
      SELECT gen_random_uuid(), ${ORG}, ${PROPERTY}::uuid, ${PORTAL}::uuid,
        'submitted', 5, true, true, ${NOW},
        ${NOW}::timestamptz + interval '24 months'
      FROM generate_series(1, ${BULK})
    `)
    const bulk = await db.execute(sql`
      SELECT id FROM guest_responses
      WHERE organization_id = ${ORG} AND property_id = ${PROPERTY}::uuid
        AND id NOT IN (SELECT response_id FROM guest_response_private_feedback)
        AND rating = 5 AND response_consent AND text_consent AND deleted_at IS NULL
        AND status = 'submitted'
    `)
    const ids = bulk.rows.map((row) => String(row.id))
    for (const id of ids) {
      await db.execute(sql`
        INSERT INTO guest_response_private_feedback (
          response_id, organization_id, property_id, portal_id, body, submitted_at,
          expires_at
        ) VALUES (${id}::uuid, ${ORG}, ${PROPERTY}::uuid, ${PORTAL}::uuid,
          ${`We loved the ${marker} spread`}, ${NOW}::timestamptz - interval '1 minute',
          ${NOW}::timestamptz + interval '1 day')
      `)
    }

    const found = await repository().findEligibleSnippetIdsForOrg(organizationId(ORG), {
      ratingMin: 4,
      textQuery: marker,
    })

    expect(found).toHaveLength(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(BULK)
    expect(new Set(found)).toEqual(new Set(ids))
    await expect(
      repository().findEligibleSnippetIdsForOrg(organizationId(OTHER_ORG), {
        textQuery: marker,
      }),
    ).resolves.toEqual([])
  })
})

describe('reading one response by its signed session', () => {
  const scope = () => ({
    organizationId: organizationId(ORG),
    propertyId: propertyId(PROPERTY),
    portalId: portalId(PORTAL),
  })

  it('maps the stored response, feedback and experience, and keeps no contact data', async () => {
    const id = randomUUID()
    const session = randomUUID()
    const sessionExpiresAt = new Date(NOW.getTime() + 86_400_000)
    const digest = 'a'.repeat(64)
    await db.execute(sql`
      INSERT INTO guest_responses (
        id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, media_consent, private_feedback_threshold,
        rating_source_event_id, feedback_source_event_id, correction_count,
        submitted_at, corrected_at, feedback_submitted_at, retention_deadline
      ) VALUES (
        ${id}::uuid, ${ORG}, ${PROPERTY}, ${PORTAL}, 'corrected', 5, true, true,
        false, 3, 'rating-event-1', 'feedback-event-1', 1, ${NOW}, ${NOW}, ${NOW},
        ${NOW}::timestamptz + interval '24 months'
      )
    `)
    await db.execute(sql`
      INSERT INTO guest_response_session_bindings (
        response_id, organization_id, property_id, portal_id, session_id, expires_at,
        created_at
      ) VALUES (${id}::uuid, ${ORG}, ${PROPERTY}, ${PORTAL}, ${session}::uuid,
        ${sessionExpiresAt}, ${NOW})
    `)
    await db.execute(sql`
      INSERT INTO guest_response_private_feedback (
        response_id, organization_id, property_id, portal_id, body, submitted_at,
        expires_at
      ) VALUES (${id}::uuid, ${ORG}, ${PROPERTY}, ${PORTAL}, 'Helpful staff', ${NOW},
        ${sessionExpiresAt})
    `)
    await db.execute(sql`
      INSERT INTO guest_response_experience_snapshots (
        response_id, organization_id, property_id, portal_id, publication_state,
        configuration_digest, guest_locale, language_pack_version,
        private_feedback_threshold, captured_at
      ) VALUES (${id}::uuid, ${ORG}, ${PROPERTY}, ${PORTAL}, 'published', ${digest},
        'en', 'guest-ui-en-v1', 3, ${NOW})
    `)

    await expect(
      repository().findForSession(scope(), guestSessionId(session), NOW),
    ).resolves.toEqual({
      id,
      ...scope(),
      sessionId: session,
      sessionExpiresAt,
      status: 'corrected',
      integrityOutcome: 'accepted',
      integrityReasonCode: 'legacy_included',
      integrityRevision: 1,
      integrityAssessedAt: expect.any(Date),
      rating: 5,
      category: null,
      text: 'Helpful staff',
      responseConsent: true,
      textConsent: true,
      mediaConsent: false,
      privateFeedbackThreshold: 3,
      experienceSnapshot: {
        portalPublicationState: 'published',
        portalPublicationSnapshotId: null,
        portalPublicationVersion: null,
        portalPublicationDigest: null,
        portalConfigurationDigest: digest,
        guestLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
        privateFeedbackThreshold: 3,
        capturedAt: NOW,
      },
      staffAttribution: null,
      ratingSourceEventId: 'rating-event-1',
      feedbackSourceEventId: 'feedback-event-1',
      correctionCount: 1,
      submittedAt: NOW,
      correctedAt: NOW,
      feedbackSubmittedAt: NOW,
      feedbackSubmissionRevision: null,
      feedbackWithdrawnAt: null,
      moderatedAt: null,
      deletedAt: null,
      retentionDeadline: expect.any(Date),
      schemaVersion: 1,
    })
  })

  it('answers null for an absent response and for a session that does not own it', async () => {
    const id = await seedResponse({ comment: 'Someone else' })

    await expect(
      repository().findById(scope(), guestResponseId(randomUUID())),
    ).resolves.toBeNull()
    await expect(
      repository().findForSession(scope(), guestSessionId(randomUUID()), NOW),
    ).resolves.toBeNull()
    await expect(
      repository().findById(scope(), guestResponseId(id)),
    ).resolves.toMatchObject({
      id,
      text: 'Someone else',
    })
  })
})
