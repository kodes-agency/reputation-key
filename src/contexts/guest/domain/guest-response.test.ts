import { describe, it, expect } from 'vitest'
import {
  type GuestResponse,
  createResponse,
  submitResponse,
  submitPrivateFeedback,
  withdrawPrivateFeedback,
  withdrawResponse,
  correctResponse,
  moderateResponse,
  deleteResponse,
  MAX_TEXT_LENGTH,
  MAX_RATING,
  MIN_RATING,
} from './guest-response'

describe('GuestResponse', () => {
  const NOW = new Date('2026-01-15T12:00:00Z')

  const baseParams = {
    id: 'resp-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    portalId: 'portal-1',
    sessionId: 'session-1',
    sessionExpiresAt: new Date('2026-01-16T12:00:00Z'),
    retentionDeadline: new Date('2026-04-15T12:00:00Z'),
    staffAttribution: null,
    experienceSnapshot: {
      portalPublicationState: 'published' as const,
      portalPublicationSnapshotId: null,
      portalPublicationVersion: null,
      portalPublicationDigest: null,
      portalConfigurationDigest: 'a'.repeat(64),
      guestLocale: 'en',
      languagePackVersion: 'guest-ui-en-v1',
      privateFeedbackThreshold: 3,
      capturedAt: NOW,
    },
  }

  describe('createResponse', () => {
    it('creates a pending response', () => {
      const r = createResponse(baseParams)
      expect(r.status).toBe('pending')
      expect(r.rating).toBeNull()
      expect(r.text).toBeNull()
      expect(r).toMatchObject({
        integrityOutcome: 'accepted',
        integrityReasonCode: 'initial_submission',
        integrityRevision: 1,
        integrityAssessedAt: NOW,
      })
      expect(r).not.toHaveProperty('contactConsent')
      expect(r).not.toHaveProperty('contactDetails')
    })
  })

  describe('submitPrivateFeedback', () => {
    it('adds feedback at the inclusive threshold without consuming correction', () => {
      const response = submitResponse(
        createResponse(baseParams),
        { rating: 3 },
        NOW,
      ) as GuestResponse
      const result = submitPrivateFeedback(
        response,
        { text: 'Please follow up.', textConsent: true },
        NOW,
      )

      expect(result).toMatchObject({
        text: 'Please follow up.',
        textConsent: true,
        feedbackSubmittedAt: NOW,
        correctionCount: 0,
      })
    })

    it('rejects feedback above the captured threshold', () => {
      const response = submitResponse(
        createResponse(baseParams),
        { rating: 4 },
        NOW,
      ) as GuestResponse
      expect(
        submitPrivateFeedback(
          response,
          { text: 'Not eligible.', textConsent: true },
          NOW,
        ),
      ).toEqual({ code: 'feedback_not_eligible' })
    })

    it('uses Unicode code points for the 2000-character feedback limit', () => {
      const response = submitResponse(
        createResponse(baseParams),
        { rating: 3 },
        NOW,
      ) as GuestResponse

      expect(
        submitPrivateFeedback(
          response,
          { text: '😀'.repeat(2000), textConsent: true },
          NOW,
        ),
      ).not.toHaveProperty('code')
      expect(
        submitPrivateFeedback(
          response,
          { text: '😀'.repeat(2001), textConsent: true },
          NOW,
        ),
      ).toEqual({ code: 'text_too_long', length: 2001, max: 2000 })
    })

    it('withdraws only feedback during the 24-hour window and keeps the rating', () => {
      const rated = submitResponse(
        createResponse(baseParams),
        { rating: 2 },
        NOW,
      ) as GuestResponse
      const feedback = submitPrivateFeedback(
        rated,
        { text: 'Please follow up.', textConsent: true },
        NOW,
      ) as GuestResponse
      const persisted = { ...feedback, feedbackSourceEventId: 'feedback-event-1' }
      const withdrawnAt = new Date('2026-01-16T11:59:59Z')

      expect(withdrawPrivateFeedback(persisted, withdrawnAt)).toMatchObject({
        status: 'submitted',
        rating: 2,
        responseConsent: true,
        text: null,
        textConsent: false,
        feedbackSubmittedAt: NOW,
        feedbackWithdrawnAt: withdrawnAt,
      })
    })

    it('rejects feedback withdrawal after 24 hours', () => {
      const rated = submitResponse(
        createResponse(baseParams),
        { rating: 2 },
        NOW,
      ) as GuestResponse
      const feedback = submitPrivateFeedback(
        rated,
        { text: 'Please follow up.', textConsent: true },
        NOW,
      ) as GuestResponse

      expect(
        withdrawPrivateFeedback(
          { ...feedback, feedbackSourceEventId: 'feedback-event-1' },
          new Date('2026-01-16T12:00:00.001Z'),
        ),
      ).toEqual({ code: 'feedback_withdrawal_expired' })
    })

    it('does not permit withdrawn private feedback to be submitted again', () => {
      const rated = submitResponse(
        createResponse(baseParams),
        { rating: 2 },
        NOW,
      ) as GuestResponse
      const feedback = submitPrivateFeedback(
        rated,
        { text: 'Please follow up.', textConsent: true },
        NOW,
      ) as GuestResponse
      const withdrawn = withdrawPrivateFeedback(
        { ...feedback, feedbackSourceEventId: 'feedback-event-1' },
        NOW,
      ) as GuestResponse

      expect(
        submitPrivateFeedback(
          { ...withdrawn, feedbackSourceEventId: null },
          { text: 'A second note.', textConsent: true },
          NOW,
        ),
      ).toEqual({ code: 'feedback_already_submitted' })
    })

    it('rejects feedback before rating submission and after response deletion', () => {
      const pending = createResponse(baseParams)
      const deleted = deleteResponse(pending, NOW) as GuestResponse

      expect(
        submitPrivateFeedback(pending, { text: 'Too early.', textConsent: true }, NOW),
      ).toEqual({ code: 'already_submitted' })
      expect(
        submitPrivateFeedback(deleted, { text: 'Too late.', textConsent: true }, NOW),
      ).toEqual({ code: 'already_deleted' })
    })

    it('accepts eligible feedback after the one permitted rating correction', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 3 },
        NOW,
      ) as GuestResponse
      const corrected = correctResponse(submitted, { rating: 2 }, NOW) as GuestResponse

      expect(
        submitPrivateFeedback(
          corrected,
          { text: 'The corrected visit rating needs follow-up.', textConsent: true },
          NOW,
        ),
      ).toMatchObject({
        status: 'corrected',
        rating: 2,
        text: 'The corrected visit rating needs follow-up.',
        feedbackSubmissionRevision: 2,
      })
    })

    it('requires meaningful text and explicit consent', () => {
      const response = submitResponse(
        createResponse(baseParams),
        { rating: 2 },
        NOW,
      ) as GuestResponse

      expect(
        submitPrivateFeedback(response, { text: '  \r\n ', textConsent: true }, NOW),
      ).toEqual({ code: 'no_content' })
      expect(
        submitPrivateFeedback(
          response,
          { text: 'Please contact me.', textConsent: false },
          NOW,
        ),
      ).toEqual({ code: 'no_content' })
    })
  })

  describe('submitResponse', () => {
    it('submits with rating only', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, { rating: 5 }, NOW)
      expect(result).toHaveProperty('status', 'submitted')
      if (!('code' in result)) {
        expect(result.rating).toBe(5)
        expect(result.submittedAt).toEqual(NOW)
      }
    })

    it('submits with text only', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, { text: 'Great service' }, NOW)
      expect(result).toHaveProperty('status', 'submitted')
    })

    it('rejects empty submission (no content)', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, {}, NOW)
      expect(result).toHaveProperty('code', 'no_content')
    })

    it('rejects whitespace-only text as no content', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, { text: '   ' }, NOW)
      expect(result).toHaveProperty('code', 'no_content')
    })

    it('rejects rating out of range (high)', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, { rating: MAX_RATING + 1 }, NOW)
      expect(result).toHaveProperty('code', 'rating_out_of_range')
    })

    it('rejects rating out of range (low)', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, { rating: MIN_RATING - 1 }, NOW)
      expect(result).toHaveProperty('code', 'rating_out_of_range')
    })

    it('rejects text too long', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(r, { text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }, NOW)
      expect(result).toHaveProperty('code', 'text_too_long')
    })

    it('normalizes private-feedback line endings and preserves paragraphs', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(
        r,
        {
          rating: 2,
          text: '  First line\r\nsecond line\r\r\nThird paragraph  ',
          responseConsent: true,
          textConsent: true,
        },
        NOW,
      ) as GuestResponse

      expect(result.text).toBe('First line\nsecond line\n\nThird paragraph')
    })

    it('rejects submission on deleted response', () => {
      const r = deleteResponse(createResponse(baseParams), NOW) as GuestResponse
      const result = submitResponse(r, { rating: 5 }, NOW)
      expect(result).toHaveProperty('code', 'already_deleted')
    })

    it('does not resubmit an existing aggregate', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 5 },
        NOW,
      ) as GuestResponse
      expect(submitResponse(submitted, { rating: 4 }, NOW)).toEqual({
        code: 'already_submitted',
      })
    })

    it('requires consent for each submitted rating and feedback body', () => {
      expect(
        submitResponse(
          createResponse(baseParams),
          { rating: 4, responseConsent: false },
          NOW,
        ),
      ).toEqual({ code: 'no_content' })
      expect(
        submitResponse(
          createResponse(baseParams),
          { text: 'A private note', textConsent: false },
          NOW,
        ),
      ).toEqual({ code: 'no_content' })
    })
  })

  describe('correctResponse', () => {
    it('corrects within the window', () => {
      const r = submitResponse(
        createResponse(baseParams),
        { rating: 5 },
        NOW,
      ) as GuestResponse
      const result = correctResponse(r, { rating: 4 }, NOW)
      expect(result).toHaveProperty('status', 'corrected')
      if (!('code' in result)) {
        expect(result.rating).toBe(4)
        expect(result.correctedAt).toEqual(NOW)
      }
    })

    it('rejects correction after window expires', () => {
      const r = submitResponse(
        createResponse(baseParams),
        { rating: 5 },
        NOW,
      ) as GuestResponse
      const result = correctResponse(r, { rating: 4 }, NOW, -1)
      expect(result).toHaveProperty('code', 'correction_window_expired')
    })

    it('rejects correction on deleted response', () => {
      const r = deleteResponse(
        submitResponse(createResponse(baseParams), { rating: 5 }, NOW) as GuestResponse,
        NOW,
      ) as GuestResponse
      const result = correctResponse(r, { rating: 4 }, NOW)
      expect(result).toHaveProperty('code', 'already_deleted')
    })

    it('allows exactly one correction', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 5 },
        NOW,
      ) as GuestResponse
      const corrected = correctResponse(submitted, { rating: 4 }, NOW) as GuestResponse
      expect(correctResponse(corrected, { rating: 3 }, NOW)).toEqual({
        code: 'already_submitted',
      })
    })

    it.each([MIN_RATING - 1, MAX_RATING + 1])(
      'rejects an out-of-range corrected rating of %i',
      (rating) => {
        const submitted = submitResponse(
          createResponse(baseParams),
          { rating: 3 },
          NOW,
        ) as GuestResponse

        expect(correctResponse(submitted, { rating }, NOW)).toEqual({
          code: 'rating_out_of_range',
          rating,
        })
      },
    )

    it('rejects corrected private feedback above the Unicode character limit', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 3 },
        NOW,
      ) as GuestResponse

      expect(
        correctResponse(submitted, { text: '😀'.repeat(MAX_TEXT_LENGTH + 1) }, NOW),
      ).toEqual({
        code: 'text_too_long',
        length: MAX_TEXT_LENGTH + 1,
        max: MAX_TEXT_LENGTH,
      })
    })

    it('rejects a correction that removes every substantive response field', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 3 },
        NOW,
      ) as GuestResponse

      expect(correctResponse(submitted, { rating: null, text: null }, NOW)).toEqual({
        code: 'no_content',
      })
    })

    it('preserves the rating while adding first-time feedback as revision two', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 2, category: 'room' },
        NOW,
      ) as GuestResponse
      const result = correctResponse(
        { ...submitted, submittedAt: null },
        { text: 'A newly added private note.' },
        NOW,
      )

      expect(result).toMatchObject({
        status: 'corrected',
        rating: 2,
        category: 'room',
        text: 'A newly added private note.',
        feedbackSubmissionRevision: 2,
      })
    })

    it('can clear feedback while explicitly changing its category', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 2, category: 'room', text: 'Initial private note.' },
        NOW,
      ) as GuestResponse

      expect(
        correctResponse(submitted, { category: 'service', text: null }, NOW),
      ).toMatchObject({
        status: 'corrected',
        rating: 2,
        category: 'service',
        text: null,
        feedbackSubmissionRevision: 1,
      })
    })
  })

  describe('moderateResponse', () => {
    it('moderates a submitted response', () => {
      const r = submitResponse(
        createResponse(baseParams),
        { rating: 5 },
        NOW,
      ) as GuestResponse
      const result = moderateResponse(r, NOW)
      expect(result).toHaveProperty('status', 'moderated')
      if (!('code' in result)) {
        expect(result.moderatedAt).toEqual(NOW)
      }
    })

    it('rejects moderating a deleted response', () => {
      const r = deleteResponse(createResponse(baseParams), NOW) as GuestResponse
      const result = moderateResponse(r, NOW)
      expect(result).toHaveProperty('code', 'already_deleted')
    })
  })

  describe('deleteResponse', () => {
    it('deletes a submitted response', () => {
      const r = submitResponse(
        createResponse(baseParams),
        { rating: 5 },
        NOW,
      ) as GuestResponse
      const result = deleteResponse(r, NOW)
      expect(result).toHaveProperty('status', 'deleted')
      if (!('code' in result)) {
        expect(result.deletedAt).toEqual(NOW)
        expect(result.rating).toBeNull()
        expect(result.text).toBeNull()
        expect(result.mediaConsent).toBe(false)
      }
    })

    it('prevents double deletion', () => {
      const r = deleteResponse(createResponse(baseParams), NOW) as GuestResponse
      const result = deleteResponse(r, NOW)
      expect(result).toHaveProperty('code', 'already_deleted')
    })
  })

  describe('withdrawResponse', () => {
    it('withdraws the complete response at the 24-hour boundary', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 4 },
        NOW,
      ) as GuestResponse
      const boundary = new Date('2026-01-16T12:00:00.000Z')

      expect(withdrawResponse(submitted, boundary)).toMatchObject({
        status: 'deleted',
        rating: null,
        deletedAt: boundary,
      })
    })

    it('rejects complete withdrawal after 24 hours', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 4 },
        NOW,
      ) as GuestResponse

      expect(withdrawResponse(submitted, new Date('2026-01-16T12:00:00.001Z'))).toEqual({
        code: 'response_withdrawal_expired',
      })
    })

    it('requires an initial submission and refuses an already deleted response', () => {
      const pending = createResponse(baseParams)
      const deleted = deleteResponse(pending, NOW) as GuestResponse

      expect(withdrawResponse(pending, NOW)).toEqual({
        code: 'response_not_submitted',
      })
      expect(withdrawResponse(deleted, NOW)).toEqual({ code: 'already_deleted' })
    })
  })

  describe('withdrawPrivateFeedback guards', () => {
    it('requires persisted feedback and refuses an already deleted response', () => {
      const submitted = submitResponse(
        createResponse(baseParams),
        { rating: 2 },
        NOW,
      ) as GuestResponse
      const deleted = deleteResponse(submitted, NOW) as GuestResponse

      expect(withdrawPrivateFeedback(submitted, NOW)).toEqual({
        code: 'feedback_not_found',
      })
      expect(withdrawPrivateFeedback(deleted, NOW)).toEqual({
        code: 'already_deleted',
      })
    })
  })
})
