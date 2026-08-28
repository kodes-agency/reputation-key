import { describe, expect, it } from 'vitest'
import {
  guestPrivateFeedbackFormDto,
  guestPrivateFeedbackMutationDto,
  guestRatingFormDto,
  guestRatingMutationDto,
} from './guest-response-form.dto'

describe('Guest response form DTOs', () => {
  it('keeps the browser rating range aligned with the transport boundary', () => {
    expect(guestRatingFormDto.safeParse({ rating: 1, honeypot: '' }).success).toBe(true)
    expect(guestRatingFormDto.safeParse({ rating: 0, honeypot: '' }).success).toBe(false)
    expect(guestRatingFormDto.safeParse({ rating: 6, honeypot: '' }).success).toBe(false)
    expect(
      guestRatingMutationDto.safeParse({
        token: 'portal-token',
        csrfNonce: '00000000-0000-4000-8000-000000000001',
        rating: 4,
        responseConsent: true,
        honeypot: '',
      }).success,
    ).toBe(true)
  })

  it('normalizes feedback through the same authority on both surfaces', () => {
    expect(
      guestPrivateFeedbackFormDto.parse({ text: '  Helpful stay.  ', honeypot: '' }),
    ).toEqual({ text: 'Helpful stay.', honeypot: '' })
    expect(
      guestPrivateFeedbackMutationDto.safeParse({
        token: 'portal-token',
        csrfNonce: '00000000-0000-4000-8000-000000000001',
        text: '   ',
        textConsent: true,
        honeypot: '',
      }).success,
    ).toBe(false)
  })

  it('bounds the shared bot trap in both form schemas', () => {
    expect(
      guestRatingFormDto.safeParse({ rating: 3, honeypot: 'x'.repeat(257) }).success,
    ).toBe(false)
    expect(
      guestPrivateFeedbackFormDto.safeParse({
        text: 'A note',
        honeypot: 'x'.repeat(257),
      }).success,
    ).toBe(false)
  })
})
