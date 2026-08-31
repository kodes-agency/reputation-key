import { describe, it, expect } from 'vitest'
import {
  guestFeedbackRetracted,
  guestScanRecorded,
  guestQualifiedScanRecorded,
  guestQualifiedScanRetracted,
  guestRatingRetracted,
  guestRatingSubmitted,
  guestFeedbackSubmitted,
  guestReviewLinkClicked,
} from './events'
import {
  scanEventId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
  feedbackId,
  portalLinkId,
  portalAccessArtifactId,
  portalGroupId,
  qualifiedScanId,
} from '#/shared/domain/ids'

const base = {
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  occurredAt: new Date('2026-01-01'),
}

const staffAttribution = {
  staffParticipantId: 'staff-participant-1',
  staffParticipationId: 'staff-participation-1',
  portalResponsibilityId: 'portal-responsibility-1',
  effectiveFrom: new Date('2025-12-01T00:00:00Z'),
  effectiveTo: null,
}

describe('Guest event envelope', () => {
  const correlationId = 'guest-response-workflow-1'
  const occurredAt = new Date('2026-01-02T03:04:05.000Z')

  it.each([
    {
      name: 'scan recorded',
      construct: () =>
        guestScanRecorded({
          ...base,
          occurredAt,
          correlationId,
          scanId: scanEventId('scan-envelope-1'),
          scanSource: 'qr',
        }),
    },
    {
      name: 'qualified scan recorded',
      construct: () =>
        guestQualifiedScanRecorded({
          ...base,
          occurredAt,
          correlationId,
          qualifiedScanId: qualifiedScanId('qualified-scan-envelope-1'),
          portalGroupId: null,
          accessArtifactId: portalAccessArtifactId('artifact-envelope-1'),
        }),
    },
    {
      name: 'qualified scan retracted',
      construct: () =>
        guestQualifiedScanRetracted({
          ...base,
          occurredAt,
          correlationId,
          qualifiedScanId: qualifiedScanId('qualified-scan-envelope-2'),
          portalGroupId: null,
          accessArtifactId: portalAccessArtifactId('artifact-envelope-2'),
          supersedesSourceEventId: 'qualified-scan-source-1',
        }),
    },
    {
      name: 'rating submitted',
      construct: () =>
        guestRatingSubmitted({
          ...base,
          occurredAt,
          correlationId,
          ratingId: ratingId('rating-envelope-1'),
          value: 5,
        }),
    },
    {
      name: 'rating retracted',
      construct: () =>
        guestRatingRetracted({
          ...base,
          occurredAt,
          correlationId,
          ratingId: ratingId('rating-envelope-2'),
          supersedesSourceEventId: 'rating-source-1',
        }),
    },
    {
      name: 'feedback submitted',
      construct: () =>
        guestFeedbackSubmitted({
          ...base,
          occurredAt,
          correlationId,
          feedbackId: feedbackId('feedback-envelope-1'),
          ratingId: ratingId('rating-envelope-3'),
        }),
    },
    {
      name: 'feedback retracted',
      construct: () =>
        guestFeedbackRetracted({
          ...base,
          occurredAt,
          correlationId,
          feedbackId: feedbackId('feedback-envelope-2'),
          supersedesSourceEventId: 'feedback-source-1',
        }),
    },
    {
      name: 'review link clicked',
      construct: () =>
        guestReviewLinkClicked({
          ...base,
          occurredAt,
          correlationId,
          linkId: portalLinkId('link-envelope-1'),
          destinationKind: 'google_review',
        }),
    },
  ])('preserves caller time and correlation for $name', ({ construct }) => {
    const event = construct()

    expect(event.occurredAt).toBe(occurredAt)
    expect(event.correlationId).toBe(correlationId)
  })
})

describe('GuestScanRecorded event', () => {
  it('creates event with valid payload', () => {
    const event = guestScanRecorded({
      ...base,
      scanId: scanEventId('scan-1'),
      scanSource: 'qr',
    })
    expect(event.scanId).toBe('scan-1')
    expect(event.scanSource).toBe('qr')
  })
})

describe('GuestRatingSubmitted event', () => {
  it('creates event with valid payload', () => {
    const event = guestRatingSubmitted({
      ...base,
      ratingId: ratingId('rating-1'),
      value: 5,
    })
    expect(event.ratingId).toBe('rating-1')
    expect(event.value).toBe(5)
  })

  it('preserves correction lineage and event-time staff attribution', () => {
    const event = guestRatingSubmitted({
      ...base,
      ratingId: ratingId('rating-2'),
      value: 4,
      supersedesSourceEventId: 'rating-event-1',
      staffAttribution,
    })
    const withoutLineage = guestRatingSubmitted({
      ...base,
      ratingId: ratingId('rating-3'),
      value: 3,
      supersedesSourceEventId: null,
    })

    expect(event).toMatchObject({
      supersedesSourceEventId: 'rating-event-1',
      staffAttribution,
    })
    expect(withoutLineage.staffAttribution).toBeNull()
  })

  it('rejects an empty correction lineage identifier', () => {
    expect(() =>
      guestRatingSubmitted({
        ...base,
        ratingId: ratingId('rating-2'),
        value: 4,
        supersedesSourceEventId: '  ',
      }),
    ).toThrow(/supersedesSourceEventId must not be empty/i)
  })
})

describe('GuestFeedbackSubmitted event', () => {
  it('creates event with valid payload', () => {
    const event = guestFeedbackSubmitted({
      ...base,
      feedbackId: feedbackId('fb-1'),
      ratingId: null,
    })
    expect(event.feedbackId).toBe('fb-1')
    expect(event.responseRevision).toBe(1)
    expect(event.staffAttribution).toBeNull()
  })

  it('preserves the exact response revision and event-time staff attribution', () => {
    const event = guestFeedbackSubmitted({
      ...base,
      feedbackId: feedbackId('fb-2'),
      ratingId: ratingId('rating-2'),
      responseRevision: 2,
      staffAttribution,
    })

    expect(event).toMatchObject({ responseRevision: 2, staffAttribution })
  })
})

describe('GuestReviewLinkClicked event', () => {
  it('creates event with valid payload', () => {
    const event = guestReviewLinkClicked({
      ...base,
      linkId: portalLinkId('link-1'),
      destinationKind: 'google_review',
    })
    expect(event.linkId).toBe('link-1')
    expect(event.destinationKind).toBe('google_review')
    expect(event.eventId).toBeTruthy()
  })
})

describe('qualified scan events', () => {
  const qualifiedScanBase = {
    ...base,
    qualifiedScanId: qualifiedScanId('qualified-scan-1'),
    portalGroupId: portalGroupId('portal-group-1'),
    accessArtifactId: portalAccessArtifactId('artifact-1'),
  }

  it('records a qualified scan with an immutable attribution snapshot', () => {
    const attributed = guestQualifiedScanRecorded({
      ...qualifiedScanBase,
      staffAttribution,
    })
    const unattributed = guestQualifiedScanRecorded({
      ...qualifiedScanBase,
      portalGroupId: null,
    })

    expect(attributed).toMatchObject({
      _tag: 'guest.qualified_scan.recorded',
      correlationId: null,
      staffAttribution,
    })
    expect(unattributed.staffAttribution).toBeNull()
  })

  it('retracts the exact qualified-scan source fact', () => {
    const retracted = guestQualifiedScanRetracted({
      ...qualifiedScanBase,
      supersedesSourceEventId: 'qualified-scan-event-1',
      staffAttribution,
    })
    const unattributed = guestQualifiedScanRetracted({
      ...qualifiedScanBase,
      supersedesSourceEventId: 'qualified-scan-event-2',
    })

    expect(retracted).toMatchObject({
      _tag: 'guest.qualified_scan.retracted',
      supersedesSourceEventId: 'qualified-scan-event-1',
      staffAttribution,
    })
    expect(unattributed.staffAttribution).toBeNull()
  })

  it('requires qualified-scan identity, artifact identity, and retraction lineage', () => {
    expect(() =>
      guestQualifiedScanRecorded({
        ...qualifiedScanBase,
        qualifiedScanId: qualifiedScanId(''),
      }),
    ).toThrow(/qualifiedScanId required/i)
    expect(() =>
      guestQualifiedScanRecorded({
        ...qualifiedScanBase,
        accessArtifactId: portalAccessArtifactId(''),
      }),
    ).toThrow(/accessArtifactId required/i)
    expect(() =>
      guestQualifiedScanRetracted({
        ...qualifiedScanBase,
        supersedesSourceEventId: '  ',
      }),
    ).toThrow(/source event id required/i)
  })
})

describe('rating and feedback retraction events', () => {
  it('retracts the exact rating fact with optional event-time attribution', () => {
    const attributed = guestRatingRetracted({
      ...base,
      ratingId: ratingId('rating-1'),
      supersedesSourceEventId: 'rating-event-1',
      staffAttribution,
    })
    const unattributed = guestRatingRetracted({
      ...base,
      ratingId: ratingId('rating-2'),
      supersedesSourceEventId: 'rating-event-2',
    })

    expect(attributed).toMatchObject({
      _tag: 'guest.rating.retracted',
      supersedesSourceEventId: 'rating-event-1',
      staffAttribution,
    })
    expect(unattributed.staffAttribution).toBeNull()
  })

  it('retracts feedback while preserving its original response revision', () => {
    const defaultRevision = guestFeedbackRetracted({
      ...base,
      feedbackId: feedbackId('feedback-1'),
      supersedesSourceEventId: 'feedback-event-1',
    })
    const attributed = guestFeedbackRetracted({
      ...base,
      feedbackId: feedbackId('feedback-2'),
      supersedesSourceEventId: 'feedback-event-2',
      responseRevision: 2,
      staffAttribution,
    })

    expect(defaultRevision).toMatchObject({
      _tag: 'guest.feedback.retracted',
      responseRevision: 1,
      staffAttribution: null,
    })
    expect(attributed).toMatchObject({ responseRevision: 2, staffAttribution })
  })

  it.each([
    {
      name: 'rating source lineage',
      construct: () =>
        guestRatingRetracted({
          ...base,
          ratingId: ratingId('rating-1'),
          supersedesSourceEventId: ' ',
        }),
      message: /source event id required/i,
    },
    {
      name: 'feedback source lineage',
      construct: () =>
        guestFeedbackRetracted({
          ...base,
          feedbackId: feedbackId('feedback-1'),
          supersedesSourceEventId: '',
        }),
      message: /source event id required/i,
    },
    {
      name: 'positive feedback response revision',
      construct: () =>
        guestFeedbackRetracted({
          ...base,
          feedbackId: feedbackId('feedback-1'),
          supersedesSourceEventId: 'feedback-event-1',
          responseRevision: 0,
        }),
      message: /responseRevision must be positive/i,
    },
  ])('requires $name', ({ construct, message }) => {
    expect(construct).toThrow(message)
  })
})
