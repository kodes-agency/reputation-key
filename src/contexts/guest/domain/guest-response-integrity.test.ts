import { describe, expect, it } from 'vitest'
import { createResponse, submitResponse, type GuestResponse } from './guest-response'
import {
  initialGuestResponseIntegrityDecision,
  isRatingMetricEligible,
  type GuestResponseInitialIntegrityAssessment,
} from './guest-response-integrity'
import {
  guestResponseId,
  guestSessionId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-01-15T12:00:00Z')

function response(): GuestResponse {
  return submitResponse(
    createResponse({
      id: guestResponseId('resp-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      sessionId: guestSessionId('session-1'),
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
    id: guestResponseId('resp-pending'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    portalId: portalId('portal-1'),
    sessionId: guestSessionId('session-pending'),
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
        id: guestResponseId('resp-filtered'),
        organizationId: organizationId('org-1'),
        propertyId: propertyId('prop-1'),
        portalId: portalId('portal-1'),
        sessionId: guestSessionId('session-filtered'),
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
      const assessment: GuestResponseInitialIntegrityAssessment = {
        outcome: 'accepted',
        reasonCode: 'initial_submission',
        source: 'system',
        actorId,
      }

      expect(() =>
        initialGuestResponseIntegrityDecision(pendingResponse(assessment), assessment),
      ).toThrow(/initial integrity assessment is invalid/i)
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

  it('requires an accepted, consented numeric rating for metric eligibility', () => {
    const eligible = response()

    expect(isRatingMetricEligible({ ...eligible, rating: null })).toBe(false)
    expect(isRatingMetricEligible({ ...eligible, responseConsent: false })).toBe(false)
    expect(
      isRatingMetricEligible({ ...eligible, integrityOutcome: 'under_review' }),
    ).toBe(false)
  })
})
