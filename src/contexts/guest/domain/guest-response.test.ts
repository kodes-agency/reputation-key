import { describe, it, expect } from 'vitest'
import {
  type GuestResponse,
  createResponse,
  submitResponse,
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
  }

  describe('createResponse', () => {
    it('creates a pending response', () => {
      const r = createResponse(baseParams)
      expect(r.status).toBe('pending')
      expect(r.rating).toBeNull()
      expect(r.text).toBeNull()
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
      }
    })

    it('prevents double deletion', () => {
      const r = deleteResponse(createResponse(baseParams), NOW) as GuestResponse
      const result = deleteResponse(r, NOW)
      expect(result).toHaveProperty('code', 'already_deleted')
    })
  })
})
