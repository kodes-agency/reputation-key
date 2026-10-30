import { describe, expect, it } from 'vitest'
import { checkReplyText, type ReplyFindingCode } from './reply-checks'

const base = {
  kind: 'final_reply' as const,
  rating: 5,
  reviewKind: 'text' as const,
  languageGroup: 'en-Latn',
  privacyMode: false,
  emojiAllowed: true,
}

function codes(text: string, overrides = {}) {
  const result = checkReplyText({ ...base, ...overrides, text })
  return {
    blocks: result.blocks.map(({ code }) => code),
    warnings: result.warnings.map(({ code }) => code),
  }
}

describe('checkReplyText block findings', () => {
  it.each([
    ['offer_or_solicitation', 'Book now for 20% off.', {}],
    ['url', 'Visit https://example.test.', {}],
    ['review_incentive', 'Remove your review and we will refund you.', {}],
    ['threat', 'Our lawyers will take legal action.', {}],
    ['accusation', 'This is a fake review from a competitor.', {}],
    ['legacy_placeholder', 'Thank you, [Name].', {}],
    ['unknown_variable', 'Thank you, {guest_name}.', {}],
    [
      'mixed_languages',
      'Thank you for taking the time to visit us. Muchas gracias por compartir su experiencia con nosotros.',
      {},
    ],
    ['too_long', 'é'.repeat(2049), {}],
    ['privacy_content', 'Thank you for your appointment.', { privacyMode: true }],
    [
      'rating_only_presumes_text',
      'Thank you for your kind words.',
      { kind: 'template_body', reviewKind: 'rating_only' },
    ],
    [
      'greeting_or_signoff_in_body',
      'Hello, thank you for choosing us.',
      { kind: 'template_body' },
    ],
    ['emoji_in_template', 'Thank you ✨', { kind: 'template_body' }],
    ['contact_in_template', 'Please email help@example.test.', { kind: 'template_body' }],
  ] satisfies readonly [ReplyFindingCode, string, Record<string, unknown>][])(
    'emits %s',
    (code, text, overrides) => {
      expect(codes(text, overrides).blocks).toContain(code)
    },
  )
})

describe('checkReplyText allows what the voice and real replies contain', () => {
  it.each([
    [
      'a contact email in a complaint reply',
      'Please contact us at manager@example.com so we can look into this.',
      { rating: 1 },
    ],
    [
      'an amenity, not an offer',
      'We are glad the complimentary shuttle made your trip easy.',
      {},
    ],
    [
      'a Spanish amenity',
      'Nos alegra que el estacionamiento gratis le haya ayudado.',
      { languageGroup: 'es-Latn' },
    ],
    [
      'a clinic name and a visit in privacy mode',
      'Hello,\n\nThank you for your visit.\n\nSmile Dental Team',
      { privacyMode: true },
    ],
    [
      'an English signer on a Spanish reply',
      'Lamentamos que su experiencia no haya cumplido sus expectativas.\n\nAtentamente,\nThe Salt and Pepper Cafe Team',
      { languageGroup: 'es-Latn', rating: 2 },
    ],
    [
      'a Spanish business name in an English reply',
      'Thank you for sharing your experience at El Rincon de la Abuela. We hope to welcome you again soon.',
      {},
    ],
    [
      'feel free without a review benefit',
      'We have updated our process since your review. Please feel free to call us.',
      { rating: 2 },
    ],
    ['a gluten-free option', 'We are glad you enjoyed the gluten-free option.', {}],
  ] satisfies readonly [string, string, Record<string, unknown>][])(
    'does not block %s',
    (_label, text, overrides) => {
      expect(codes(text, overrides).blocks).toEqual([])
    },
  )
})

describe('checkReplyText review incentives', () => {
  it.each([
    'Elimine su reseña y le daremos un reembolso.',
    "Update your review and we'll refund you.",
    "We'll refund you if you remove your review.",
    'Le daremos un reembolso si elimina su reseña.',
  ])('blocks a benefit offered for changing a review: %s', (text) => {
    expect(codes(text).blocks).toContain('review_incentive')
  })
})

describe('checkReplyText incentive and sign-off edge cases', () => {
  it('does not treat a policy update after a review as an incentive', () => {
    expect(
      codes('Thank you for your review. We have updated our refund policy as a result.', {
        rating: 2,
      }).blocks,
    ).not.toContain('review_incentive')
  })

  it('blocks an incentive inside one sentence wherever it sits', () => {
    expect(
      codes(
        'We have made several changes. If you remove your review, we will offer you a refund.',
        {
          rating: 1,
        },
      ).blocks,
    ).toContain('review_incentive')
  })

  it('treats the voice sign-offs as sign-offs, not a second language', () => {
    expect(
      codes(
        'Hello Maria,\n\nWe are sorry the wait was so long and we would like to hear more about it.\n\nKind regards,\nAna Ruiz, General Manager at El Rincon de la Abuela Restaurant',
        { rating: 2 },
      ).blocks,
    ).not.toContain('mixed_languages')
  })
})

describe('checkReplyText warning findings', () => {
  it.each([
    ['stock_phrases', 'We are thrilled. Your feedback is important to us.', {}],
    ['conditional_apology', 'Sorry you feel that way.', {}],
    ['fault_or_incident', 'The injury was our fault.', {}],
    ['staff_name_in_complaint', 'We will speak with {staff_name}.', { rating: 2 }],
    ['emoji_in_complaint', 'Thank you. 😞', { rating: 2 }],
    ['emoji_not_allowed', 'Thank you. ✨', { emojiAllowed: false }],
    [
      'too_many_words',
      Array.from({ length: 31 }, () => 'word').join(' '),
      { reviewKind: 'rating_only' },
    ],
    ['too_many_exclamations', 'Thank you! See you soon!', {}],
    ['business_name_in_body', 'Thank you from Harbor Hotel.', { kind: 'template_body' }],
  ] satisfies readonly [ReplyFindingCode, string, Record<string, unknown>][])(
    'emits %s',
    (code, text, overrides) => {
      expect(codes(text, overrides).warnings).toContain(code)
    },
  )
})
