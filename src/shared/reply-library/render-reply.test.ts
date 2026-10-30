import { describe, expect, it } from 'vitest'
import { BUILTIN_REPLY_VOICE, resolveVoice } from './reply-voice'
import { isReplyRenderError, renderReply } from './render-reply'

const choices = {
  closing: 0,
  signOff: 0,
  contactSentence: 0,
  emoji: 0,
}

describe('renderReply', () => {
  it('frames an English positive body with the first name and one closing emoji', () => {
    const voice = resolveVoice(
      BUILTIN_REPLY_VOICE,
      {
        overriddenFields: ['emojiMode', 'emojiSet', 'businessNameShort'],
        emojiMode: 'positive',
        emojiSet: ['✨'],
        businessNameShort: 'Harbor House',
      },
      null,
    )

    expect(
      renderReply({
        body: 'Thank you for highlighting {staff_name}.',
        voice,
        languageGroup: 'en-Latn',
        rating: 5,
        hasText: true,
        reviewerDisplayName: 'MARIA LOPEZ',
        propertyDisplayName: 'Harbor House Hotel',
        choices,
      }).text,
    ).toBe(
      'Hi Maria,\n\nThank you for highlighting {staff_name}.\n\nWe hope to see you again soon. ✨\n\nWarm regards,\nHarbor House Team',
    )
  })

  it('frames a Spanish complaint with fallback greeting, contact, and a named signer', () => {
    const voice = resolveVoice(
      BUILTIN_REPLY_VOICE,
      {
        overriddenFields: ['contact', 'signerName', 'signerTitle'],
        contact: 'ayuda@example.test',
        signerName: 'Ana Ruiz',
        signerTitle: 'Gerente General',
      },
      null,
    )
    expect(
      renderReply({
        body: 'Lamentamos que la experiencia no haya cumplido sus expectativas.',
        voice,
        languageGroup: 'es-Latn',
        rating: 2,
        hasText: true,
        reviewerDisplayName: 'Dr. Smith',
        propertyDisplayName: 'Casa Azul',
        choices,
      }).text,
    ).toBe(
      'Hola,\n\nLamentamos que la experiencia no haya cumplido sus expectativas.\n\nComuníquese con nosotros en ayuda@example.test para conversar sobre lo ocurrido.\n\nGracias por informarnos.\n\nAtentamente,\nAna Ruiz, Gerente General',
    )
  })

  it('frames Bulgarian with a Cyrillic first name and falls back when the name is unsafe', () => {
    const voice = resolveVoice(BUILTIN_REPLY_VOICE, null, null)
    const named = renderReply({
      body: 'Благодарим Ви за прекрасния отзив.',
      voice,
      languageGroup: 'bg-Cyrl',
      rating: 5,
      hasText: true,
      reviewerDisplayName: 'АННА Петрова',
      propertyDisplayName: 'Хотел Море',
      choices,
    })
    const fallback = renderReply({
      body: 'Благодарим Ви за отзива.',
      voice,
      languageGroup: 'bg-Cyrl',
      rating: 5,
      hasText: true,
      reviewerDisplayName: 'Google User',
      propertyDisplayName: 'Хотел Море',
      choices,
    })

    expect(named.text).toContain('Здравейте, Анна,')
    expect(fallback.text).toMatch(/^Здравейте,\n\n/u)
  })

  it('uses privacy fallback, omits optional three-star contact, and keeps a stable digest', () => {
    const voice = resolveVoice(
      BUILTIN_REPLY_VOICE,
      {
        overriddenFields: ['privacyMode', 'contact'],
        privacyMode: true,
        contact: '555-0100',
      },
      null,
    )
    const first = renderReply({
      body: 'Thank you for the balanced feedback.',
      voice,
      languageGroup: 'en-Latn',
      rating: 3,
      hasText: true,
      reviewerDisplayName: 'Maria Lopez',
      propertyDisplayName: 'Harbor House',
      choices: { ...choices, includeContact: false },
    })
    const second = renderReply({
      body: 'A different body.',
      voice,
      languageGroup: 'en-Latn',
      rating: 3,
      hasText: true,
      reviewerDisplayName: 'Someone Else',
      propertyDisplayName: 'Harbor House',
      choices: { ...choices, includeContact: false },
    })

    expect(first.text).toContain('Hello,\n\nThank you for the balanced feedback.')
    expect(first.text).not.toContain('555-0100')
    expect(first.voiceDigest).toBe(second.voiceDigest)
  })

  it('never names the visit as an appointment in privacy mode', () => {
    const voice = resolveVoice(
      BUILTIN_REPLY_VOICE,
      {
        overriddenFields: ['privacyMode', 'visitWordKey'],
        privacyMode: true,
        visitWordKey: 'appointment',
      },
      null,
    )
    const rendered = renderReply({
      body: 'We are glad everything went well.',
      voice,
      languageGroup: 'en-Latn',
      rating: 5,
      hasText: true,
      reviewerDisplayName: 'Maria Lopez',
      propertyDisplayName: 'Smile Dental',
      choices: { ...choices, closing: 1 },
    })

    expect(rendered.text).toContain('We look forward to your next visit.')
    expect(rendered.text).not.toContain('appointment')
    expect(rendered.text).not.toContain('Maria')
  })

  it('leaves an unknown or prototype placeholder as text', () => {
    const voice = resolveVoice(BUILTIN_REPLY_VOICE, null, null)
    const rendered = renderReply({
      body: 'Thank you {__proto__} and {constructor}.',
      voice,
      languageGroup: 'en-Latn',
      rating: 5,
      hasText: true,
      reviewerDisplayName: 'Maria Lopez',
      propertyDisplayName: 'Harbor House',
      choices,
    })
    expect(rendered.text).toContain('Thank you {__proto__} and {constructor}.')
  })

  it('refuses a rendered reply over Google’s 4,096-byte limit', () => {
    const voice = resolveVoice(BUILTIN_REPLY_VOICE, null, null)
    try {
      renderReply({
        body: 'é'.repeat(2048),
        voice,
        languageGroup: 'en-Latn',
        rating: 5,
        hasText: true,
        reviewerDisplayName: null,
        propertyDisplayName: 'Harbor House',
        choices,
      })
      expect.unreachable('expected the oversized rendered reply to be refused')
    } catch (error) {
      expect(isReplyRenderError(error)).toBe(true)
      expect(error).toMatchObject({
        _tag: 'ReplyRenderError',
        code: 'too_long',
        message: expect.stringContaining('4,096'),
      })
      expect(error).not.toBeInstanceOf(RangeError)
    }
  })

  it('treats a blank contact as no contact', () => {
    const voice = resolveVoice(
      BUILTIN_REPLY_VOICE,
      { overriddenFields: ['contact'], contact: '   ' },
      null,
    )

    expect(
      renderReply({
        body: 'Thank you for letting us know.',
        voice,
        languageGroup: 'en-Latn',
        rating: 1,
        hasText: true,
        reviewerDisplayName: null,
        propertyDisplayName: 'Harbor House',
        choices,
      }).text,
    ).not.toContain('contact us')
  })
})
