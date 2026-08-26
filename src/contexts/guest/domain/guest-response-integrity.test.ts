import { describe, expect, it } from 'vitest'
import { createResponse, submitResponse, type GuestResponse } from './guest-response'
import {
  changeGuestResponseIntegrity,
  initialGuestResponseIntegrityDecision,
  isRatingMetricEligible,
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
})
