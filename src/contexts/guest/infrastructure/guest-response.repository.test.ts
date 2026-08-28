import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { createGuestResponseRepository } from './repositories/guest-response.repository'

const REPOSITORY_NOW = new Date('2026-08-16T12:00:00.000Z')
const repository = (db: Database) =>
  createGuestResponseRepository(db, () => REPOSITORY_NOW)

const scope = {
  organizationId: 'org-1',
  propertyId: 'property-1',
  portalId: 'portal-1',
}

function selectDatabase(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  let whereCondition: unknown
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.leftJoin = vi.fn(() => chain)
  chain.groupBy = vi.fn(async () => rows)
  chain.where = vi.fn((condition: unknown) => {
    whereCondition = condition
    return chain
  })
  chain.limit = vi.fn(async () => rows)
  chain.then = (resolve: (value: readonly unknown[]) => unknown) =>
    Promise.resolve(rows).then(resolve)
  return {
    db: { select: vi.fn(() => chain) } as unknown as Database,
    chain,
    getWhereCondition: () => whereCondition,
  }
}

describe('createGuestResponseRepository', () => {
  it('maps a tenant-scoped response without inventing retained contact data', async () => {
    const submittedAt = new Date('2026-08-16T12:00:00.000Z')
    const sessionExpiresAt = new Date('2026-08-17T12:00:00.000Z')
    const retentionDeadline = new Date('2026-09-15T12:00:00.000Z')
    const { db, chain } = selectDatabase([
      {
        response: {
          id: 'response-1',
          ...scope,
          status: 'corrected',
          integrityOutcome: 'accepted',
          integrityReasonCode: 'initial_submission',
          integrityRevision: 1,
          integrityAssessedAt: submittedAt,
          rating: 5,
          categoryId: 'service',
          responseConsent: true,
          textConsent: true,
          mediaConsent: false,
          privateFeedbackThreshold: 3,
          ratingSourceEventId: 'rating-event-1',
          feedbackSourceEventId: 'feedback-event-1',
          attributedStaffParticipantId: null,
          attributedStaffParticipationId: null,
          attributionResponsibilityId: null,
          staffAttributionEffectiveFrom: null,
          staffAttributionEffectiveTo: null,
          correctionCount: 9,
          submittedAt,
          correctedAt: submittedAt,
          feedbackSubmittedAt: submittedAt,
          feedbackSubmissionRevision: null,
          feedbackWithdrawnAt: null,
          moderatedAt: null,
          deletedAt: null,
          retentionDeadline,
        },
        binding: { sessionId: 'session-1', expiresAt: sessionExpiresAt },
        feedback: { body: 'Helpful staff' },
        experience: {
          publicationState: 'published',
          publicationSnapshotId: null,
          publicationVersion: null,
          publicationDigest: null,
          configurationDigest: 'a'.repeat(64),
          guestLocale: 'en',
          languagePackVersion: 'guest-ui-en-v1',
          privateFeedbackThreshold: 3,
          capturedAt: submittedAt,
        },
      },
    ])

    await expect(
      repository(db).findForSession(scope, 'session-1', submittedAt),
    ).resolves.toEqual({
      id: 'response-1',
      ...scope,
      sessionId: 'session-1',
      sessionExpiresAt,
      status: 'corrected',
      integrityOutcome: 'accepted',
      integrityReasonCode: 'initial_submission',
      integrityRevision: 1,
      integrityAssessedAt: submittedAt,
      rating: 5,
      category: 'service',
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
        portalConfigurationDigest: 'a'.repeat(64),
        guestLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
        privateFeedbackThreshold: 3,
        capturedAt: submittedAt,
      },
      staffAttribution: null,
      ratingSourceEventId: 'rating-event-1',
      feedbackSourceEventId: 'feedback-event-1',
      correctionCount: 0,
      submittedAt,
      correctedAt: submittedAt,
      feedbackSubmittedAt: submittedAt,
      feedbackSubmissionRevision: null,
      feedbackWithdrawnAt: null,
      moderatedAt: null,
      deletedAt: null,
      retentionDeadline,
      schemaVersion: 1,
    })
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when the scoped response is absent', async () => {
    await expect(
      repository(selectDatabase([]).db).findById(scope, 'missing'),
    ).resolves.toBeNull()
  })

  it('batches only consented response fields for inbox enrichment', async () => {
    const { db, chain, getWhereCondition } = selectDatabase([
      {
        id: 'response-1',
        comment: 'Private comment',
        ratingValue: 5,
        textConsent: false,
        responseConsent: true,
      },
      {
        id: 'response-2',
        comment: 'Shared comment',
        ratingValue: 2,
        textConsent: true,
        responseConsent: false,
      },
    ])

    await expect(
      repository(db).findSnippetsForOrg('org-1', ['response-1', 'response-2']),
    ).resolves.toEqual([
      { id: 'response-1', comment: null, ratingValue: 5 },
      { id: 'response-2', comment: 'Shared comment', ratingValue: null },
    ])
    expect(chain.where).toHaveBeenCalledOnce()
    const compiled = new PgDialect().sqlToQuery(getWhereCondition() as SQL)
    expect(compiled.sql).toContain('"guest_responses"."organization_id" =')
    expect(compiled.sql).toContain('"guest_responses"."id" in')
    expect(compiled.params).toEqual(
      expect.arrayContaining(['org-1', 'response-1', 'response-2']),
    )
  })

  it('returns every id selected by the consent-aware content query', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `response-${index + 1}`,
    }))
    const { db, chain, getWhereCondition } = selectDatabase(rows)

    await expect(
      repository(db).findEligibleSnippetIdsForOrg('org-1', {
        ratingMin: 4,
        textQuery: 'breakfast',
      }),
    ).resolves.toHaveLength(1001)
    expect(chain.limit).not.toHaveBeenCalled()
    const compiled = new PgDialect().sqlToQuery(getWhereCondition() as SQL)
    expect(compiled.sql).toContain('"guest_responses"."organization_id" =')
    expect(compiled.sql).toContain('"guest_responses"."response_consent" =')
    expect(compiled.sql).toContain('"guest_responses"."text_consent" =')
  })

  it('summarizes current outcomes by rating business time and exact scope', async () => {
    const { db, chain, getWhereCondition } = selectDatabase([
      { outcome: 'accepted', count: 7 },
      { outcome: 'filtered_automatically', count: 1 },
      { outcome: 'under_review', count: 2 },
    ])
    const startAt = new Date('2026-08-01T00:00:00.000Z')
    const endAt = new Date('2026-09-01T00:00:00.000Z')

    await expect(
      repository(db).summarizePortalIntegrity(scope, startAt, endAt),
    ).resolves.toEqual({
      accepted: 7,
      filteredAutomatically: 1,
      underReview: 2,
      total: 10,
    })
    expect(chain.groupBy).toHaveBeenCalledOnce()
    const compiled = new PgDialect().sqlToQuery(getWhereCondition() as SQL)
    expect(compiled.sql).toContain('"guest_responses"."organization_id" =')
    expect(compiled.sql).toContain('"guest_responses"."property_id" =')
    expect(compiled.sql).toContain('"guest_responses"."portal_id" =')
    expect(compiled.sql).toContain('COALESCE')
    expect(compiled.sql).toContain('>=')
    expect(compiled.sql).toContain('<')
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        scope.organizationId,
        scope.propertyId,
        scope.portalId,
        startAt,
        endAt,
      ]),
    )
  })
})
