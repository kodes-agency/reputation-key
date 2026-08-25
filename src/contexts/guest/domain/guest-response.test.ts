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
    privateFeedbackThreshold: 3,
  }

  describe('createResponse', () => {
    it('creates a pending response', () => {
      const r = createResponse(baseParams)
      expect(r.status).toBe('pending')
      expect(r.rating).toBeNull()
      expect(r.text).toBeNull()
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
        contactConsent: false,
        contactDetails: null,
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

    it('rejects contact details without consent', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(
        r,
        {
          rating: 5,
          contactDetails: 'email@example.com',
          contactConsent: false,
        },
        NOW,
      )
      expect(result).toHaveProperty('code', 'contact_without_consent')
    })

    it('accepts contact details with consent', () => {
      const r = createResponse(baseParams)
      const result = submitResponse(
        r,
        {
          rating: 5,
          contactDetails: 'email@example.com',
          contactConsent: true,
        },
        NOW,
      )
      expect(result).toHaveProperty('status', 'submitted')
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
  })
})
