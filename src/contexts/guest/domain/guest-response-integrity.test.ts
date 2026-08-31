import { describe, expect, it } from 'vitest'
import {
  correctResponse,
  createResponse,
  deleteResponse,
  submitResponse,
  type GuestResponse,
} from './guest-response'
import {
  changeGuestResponseIntegrity,
  initialGuestResponseIntegrityDecision,
  isRatingMetricEligible,
  ratingMetricOccurredAt,
  type GuestResponseInitialIntegrityAssessment,
} from './guest-response-integrity'

const NOW = new Date('2026-01-15T12:00:00Z')
const LATER = new Date('2026-01-15T13:00:00Z')

function response(): GuestResponse {
  return submitResponse(
    createResponse({
      id: 'resp-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      sessionId: 'session-1',
      sessionExpiresAt: new Date('2026-01-16T12:00:00Z'),
      retentionDeadline: new Date('2028-01-15T12:00:00Z'),
      staffAttribution: null,
      experienceSnapshot: {
        portalPublicationState: 'published',
        portalPublicationSnapshotId: null,
        portalPublicationVersion: null,
        portalPublicationDigest: null,
        portalConfigurationDigest: 'a'.repeat(64),
        guestLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
        privateFeedbackThreshold: 3,
        capturedAt: NOW,
      },
    }),
    { rating: 2 },
    NOW,
  ) as GuestResponse
}

function pendingResponse(
  integrityAssessment?: GuestResponseInitialIntegrityAssessment,
): GuestResponse {
  return createResponse({
    id: 'resp-pending',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    portalId: 'portal-1',
    sessionId: 'session-pending',
    sessionExpiresAt: new Date('2026-01-16T12:00:00Z'),
    retentionDeadline: new Date('2028-01-15T12:00:00Z'),
    staffAttribution: null,
    integrityAssessment,
    experienceSnapshot: {
      portalPublicationState: 'published',
      portalPublicationSnapshotId: null,
      portalPublicationVersion: null,
      portalPublicationDigest: null,
      portalConfigurationDigest: 'a'.repeat(64),
      guestLocale: 'en',
      languagePackVersion: 'guest-ui-en-v1',
      privateFeedbackThreshold: 3,
      capturedAt: NOW,
    },
  })
}

describe('Guest Response integrity', () => {
  it('creates an auditable initial acceptance without exposing guest content', () => {
    expect(initialGuestResponseIntegrityDecision(response())).toEqual({
      responseId: 'resp-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      revision: 1,
      previousOutcome: null,
      outcome: 'accepted',
      reasonCode: 'initial_submission',
      source: 'system',
      actorId: 'guest.gateway',
      decidedAt: NOW,
    })
  })

  it('records a server-owned automatic initial filter without changing the rating', () => {
    const assessment: GuestResponseInitialIntegrityAssessment = {
      outcome: 'filtered_automatically',
      reasonCode: 'honeypot_signal',
      source: 'automatic',
      actorId: 'guest-integrity-honeypot-v1',
    }
    const filtered = submitResponse(
      createResponse({
        id: 'resp-filtered',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalId: 'portal-1',
        sessionId: 'session-filtered',
        sessionExpiresAt: new Date('2026-01-16T12:00:00Z'),
        retentionDeadline: new Date('2028-01-15T12:00:00Z'),
        staffAttribution: null,
        integrityAssessment: assessment,
        experienceSnapshot: {
          portalPublicationState: 'published',
          portalPublicationSnapshotId: null,
          portalPublicationVersion: null,
          portalPublicationDigest: null,
          portalConfigurationDigest: 'a'.repeat(64),
          guestLocale: 'en',
          languagePackVersion: 'guest-ui-en-v1',
          privateFeedbackThreshold: 3,
          capturedAt: NOW,
        },
      }),
      { rating: 5 },
      NOW,
    ) as GuestResponse

    expect(filtered).toMatchObject({
      rating: 5,
      integrityOutcome: 'filtered_automatically',
      integrityReasonCode: 'honeypot_signal',
    })
    expect(isRatingMetricEligible(filtered)).toBe(false)
    expect(initialGuestResponseIntegrityDecision(filtered, assessment)).toMatchObject({
      previousOutcome: null,
      outcome: 'filtered_automatically',
      reasonCode: 'honeypot_signal',
      source: 'automatic',
      actorId: 'guest-integrity-honeypot-v1',
    })
  })

  it('moves a plausible anomaly under review without changing its rating', () => {
    const current = response()
    const result = changeGuestResponseIntegrity(
      current,
      {
        outcome: 'under_review',
        reasonCode: 'traffic_velocity_anomaly',
        source: 'automatic',
        actorId: 'guest-integrity-v1',
      },
      LATER,
    )

    expect(result).toMatchObject({
      response: {
        rating: 2,
        integrityOutcome: 'under_review',
        integrityReasonCode: 'traffic_velocity_anomaly',
        integrityRevision: 2,
        integrityAssessedAt: LATER,
      },
      decision: {
        revision: 2,
        previousOutcome: 'accepted',
        outcome: 'under_review',
        source: 'automatic',
      },
    })
    expect('code' in result ? true : isRatingMetricEligible(result.response)).toBe(false)
  })

  it('allows a reasoned reviewer restoration and increments the audit revision', () => {
    const current = response()
    const excluded = changeGuestResponseIntegrity(
      current,
      {
        outcome: 'filtered_automatically',
        reasonCode: 'automation_signature',
        source: 'automatic',
        actorId: 'guest-integrity-v1',
      },
      LATER,
    )
    if ('code' in excluded) throw new Error(excluded.code)

    const restoredAt = new Date('2026-01-15T14:00:00Z')
    const restored = changeGuestResponseIntegrity(
      excluded.response,
      {
        outcome: 'accepted',
        reasonCode: 'reviewer_restored',
        source: 'reviewer',
        actorId: 'reviewer-1',
      },
      restoredAt,
    )

    expect(restored).toMatchObject({
      response: {
        integrityOutcome: 'accepted',
        integrityReasonCode: 'reviewer_restored',
        integrityRevision: 3,
      },
      decision: {
        revision: 3,
        previousOutcome: 'filtered_automatically',
        outcome: 'accepted',
        actorId: 'reviewer-1',
      },
    })
    expect('code' in restored ? false : isRatingMetricEligible(restored.response)).toBe(
      true,
    )
  })

  it('rejects unauditable, no-op, and misleading reviewer decisions', () => {
    const current = response()
    expect(
      changeGuestResponseIntegrity(
        current,
        {
          outcome: 'under_review',
          reasonCode: '',
          source: 'automatic',
          actorId: 'guest-integrity-v1',
        },
        LATER,
      ),
    ).toEqual({ code: 'invalid_integrity_reason' })
    expect(
      changeGuestResponseIntegrity(
        current,
        {
          outcome: 'accepted',
          reasonCode: 'reviewer_restored',
          source: 'reviewer',
          actorId: 'reviewer-1',
        },
        LATER,
      ),
    ).toEqual({ code: 'integrity_outcome_unchanged' })
    expect(
      changeGuestResponseIntegrity(
        current,
        {
          outcome: 'filtered_automatically',
          reasonCode: 'reviewer_filtered',
          source: 'reviewer',
          actorId: 'reviewer-1',
        },
        LATER,
      ),
    ).toEqual({ code: 'invalid_integrity_transition' })
  })

  it.each(['_leading', 'trailing_', 'double__separator', 'Uppercase', 'x'.repeat(101)])(
    'rejects the non-canonical initial reason code %s',
    (reasonCode) => {
      const assessment: GuestResponseInitialIntegrityAssessment = {
        outcome: 'accepted',
        reasonCode,
        source: 'system',
        actorId: 'guest.gateway',
      }

      expect(() =>
        initialGuestResponseIntegrityDecision(pendingResponse(assessment), assessment),
      ).toThrow(/initial integrity assessment is invalid/i)
    },
  )

  it.each(['', 'x'.repeat(256), '-leading', 'guest actor'])(
    'rejects the invalid integrity actor identifier %j',
    (actorId) => {
      expect(
        changeGuestResponseIntegrity(
          response(),
          {
            outcome: 'under_review',
            reasonCode: 'manual_review',
            source: 'automatic',
            actorId,
          },
          LATER,
        ),
      ).toEqual({ code: 'invalid_integrity_actor' })
    },
  )

  it('rejects initial decisions whose response and assessment evidence disagree', () => {
    const accepted = pendingResponse()

    expect(() =>
      initialGuestResponseIntegrityDecision({ ...accepted, integrityRevision: 2 }),
    ).toThrow(/initial integrity assessment is invalid/i)
    expect(() =>
      initialGuestResponseIntegrityDecision({
        ...accepted,
        integrityOutcome: 'under_review',
      }),
    ).toThrow(/initial integrity assessment is invalid/i)
    expect(() =>
      initialGuestResponseIntegrityDecision({
        ...accepted,
        integrityReasonCode: 'different_reason',
      }),
    ).toThrow(/initial integrity assessment is invalid/i)
    expect(() =>
      initialGuestResponseIntegrityDecision(accepted, {
        outcome: 'accepted',
        reasonCode: 'initial_submission',
        source: 'system',
        actorId: '-invalid',
      }),
    ).toThrow(/initial integrity assessment is invalid/i)
  })

  it('only changes integrity after submission and before deletion', () => {
    const pending = pendingResponse()
    const deleted = deleteResponse(response(), LATER) as GuestResponse
    const input = {
      outcome: 'under_review' as const,
      reasonCode: 'manual_review',
      source: 'reviewer' as const,
      actorId: 'reviewer-1',
    }

    expect(changeGuestResponseIntegrity(pending, input, LATER)).toEqual({
      code: 'response_not_submitted',
    })
    expect(changeGuestResponseIntegrity(deleted, input, LATER)).toEqual({
      code: 'already_deleted',
    })
  })

  it('anchors rating metrics to correction, submission, then assessment time', () => {
    const submitted = response()
    const correctedAt = new Date('2026-01-15T12:30:00Z')
    const corrected = correctResponse(
      submitted,
      { rating: 3 },
      correctedAt,
    ) as GuestResponse

    expect(ratingMetricOccurredAt(corrected)).toBe(correctedAt)
    expect(ratingMetricOccurredAt(submitted)).toBe(NOW)
    expect(
      ratingMetricOccurredAt({
        ...pendingResponse(),
        submittedAt: null,
        correctedAt: null,
      }),
    ).toBe(NOW)
  })

  it('requires an accepted, consented numeric rating for metric eligibility', () => {
    const eligible = response()

    expect(isRatingMetricEligible({ ...eligible, rating: null })).toBe(false)
    expect(isRatingMetricEligible({ ...eligible, responseConsent: false })).toBe(false)
  })
})
