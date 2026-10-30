import { describe, expect, it } from 'vitest'
import {
  BUILTIN_REPLY_VOICE,
  DEFAULT_REPLY_VOICE_SETTINGS,
  replyBand,
  resolveVoice,
} from './reply-voice'

describe('reply voice resolution', () => {
  it('resolves field-by-field and preserves an explicit property none', () => {
    const resolved = resolveVoice(
      BUILTIN_REPLY_VOICE,
      {
        overriddenFields: ['contact', 'greetingStyle', 'signerName'],
        contact: 'help@example.test',
        greetingStyle: { positive: 'hello', negative: 'dear' },
        signerName: 'Ana Ruiz',
      },
      {
        overriddenFields: ['contact', 'emojiMode'],
        contact: null,
        emojiMode: 'positive',
      },
    )

    expect(resolved.contact).toEqual({ value: null, source: 'property' })
    expect(resolved.greetingStyle).toEqual({
      value: { positive: 'hello', negative: 'dear' },
      source: 'account',
    })
    expect(resolved.emojiMode).toEqual({ value: 'positive', source: 'property' })
    expect(resolved.useFirstName).toEqual({
      value: DEFAULT_REPLY_VOICE_SETTINGS.useFirstName,
      source: 'builtin',
    })
  })

  it('resolves localized arrays independently', () => {
    const resolved = resolveVoice(
      BUILTIN_REPLY_VOICE,
      {
        overriddenFields: [],
        localized: {
          'en-Latn': { closings: { negative: [] } },
        },
      },
      null,
    )
    expect(resolved.localized['en-Latn'].closings.negative).toEqual({
      value: [],
      source: 'account',
    })
    expect(resolved.localized['es-Latn'].closings.negative.source).toBe('builtin')
  })
})

describe('replyBand', () => {
  it.each([
    [5, true, 'positiveText'],
    [4, false, 'positiveRatingOnly'],
    [3, true, 'threeStar'],
    [3, false, 'threeStar'],
    [2, true, 'negative'],
    [1, false, 'negative'],
  ] as const)('maps %s stars and hasText=%s to %s', (rating, hasText, expected) => {
    expect(replyBand(rating, hasText)).toBe(expected)
  })
})
