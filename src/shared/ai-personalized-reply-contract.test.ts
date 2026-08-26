import { describe, expect, it } from 'vitest'
import {
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  parsePersonalizedReplyDraft,
  type PersonalizedReplyDraftInput,
} from './ai-personalized-reply-contract'

const ENGLISH = {
  reviewText: 'The room was quiet and the breakfast team was exceptionally kind.',
  rating: 5,
  targetLanguageTag: 'en-Latn',
  tone: 'friendly',
  countryCode: 'GB',
  output: {
    languageCode: 'en-Latn',
    replyText:
      'Thank you for sharing this. We are delighted that the quiet room and the kindness of our breakfast team made your stay enjoyable.',
    grounding: [
      {
        sourceExcerpt: 'room was quiet',
        replyExcerpt: 'quiet room',
      },
      {
        sourceExcerpt: 'breakfast team was exceptionally kind',
        replyExcerpt: 'kindness of our breakfast team',
      },
    ],
  },
} satisfies PersonalizedReplyDraftInput

describe('personalized reply draft contract', () => {
  it('accepts a genuinely grounded English draft', () => {
    expect(parsePersonalizedReplyDraft(ENGLISH)).toEqual({
      status: 'accepted',
      profileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
      draft: ENGLISH.output,
    })
  })

  it('accepts a grounded Bulgarian draft', () => {
    const result = parsePersonalizedReplyDraft({
      reviewText: 'Стаята беше тиха, а екипът на закуска беше много любезен.',
      rating: 5,
      targetLanguageTag: 'bg-Cyrl-BG',
      tone: 'professional',
      countryCode: 'BG',
      output: {
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Благодарим ви за отзива. Радваме се, че тихата стая и любезният екип на закуска са допринесли за приятния ви престой.',
        grounding: [
          {
            sourceExcerpt: 'Стаята беше тиха',
            replyExcerpt: 'тихата стая',
          },
          {
            sourceExcerpt: 'екипът на закуска беше много любезен',
            replyExcerpt: 'любезният екип на закуска',
          },
        ],
      },
    })

    expect(result.status).toBe('accepted')
  })

  it.each([
    ['unsupported target language', { targetLanguageTag: 'de-Latn-DE' }, 'language'],
    [
      'language mismatch',
      { output: { ...ENGLISH.output, languageCode: 'bg-Cyrl-BG' } },
      'language',
    ],
    [
      'missing review evidence',
      {
        output: {
          ...ENGLISH.output,
          grounding: [{ sourceExcerpt: 'rooftop pool', replyExcerpt: 'quiet room' }],
        },
      },
      'grounding',
    ],
    [
      'missing reply evidence',
      {
        output: {
          ...ENGLISH.output,
          grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'rooftop pool' }],
        },
      },
      'grounding',
    ],
    ['ungrounded output', { output: { ...ENGLISH.output, grounding: [] } }, 'shape'],
    [
      'compensation promise',
      {
        output: {
          ...ENGLISH.output,
          replyText: `${ENGLISH.output.replyText} We guarantee a free refund.`,
        },
      },
      'prohibited_content',
    ],
    [
      'liability admission in Bulgarian',
      {
        reviewText: 'Обслужването беше бавно и стаята не беше готова.',
        targetLanguageTag: 'bg-Cyrl-BG',
        countryCode: 'BG',
        output: {
          languageCode: 'bg-Cyrl-BG',
          replyText:
            'Благодарим ви за обратната връзка. Признаваме вина и обещаваме обезщетение за бавното обслужване.',
          grounding: [
            {
              sourceExcerpt: 'Обслужването беше бавно',
              replyExcerpt: 'бавното обслужване',
            },
          ],
        },
      },
      'prohibited_content',
    ],
  ] as const)('rejects %s', (_name, overrides, reason) => {
    const result = parsePersonalizedReplyDraft({
      ...ENGLISH,
      ...overrides,
      output: 'output' in overrides ? overrides.output : ENGLISH.output,
    })

    expect(result).toEqual({ status: 'rejected', reason })
  })

  it('rejects loose or oversized provider output', () => {
    expect(
      parsePersonalizedReplyDraft({
        ...ENGLISH,
        output: { ...ENGLISH.output, unexpected: 'field' },
      }),
    ).toEqual({ status: 'rejected', reason: 'shape' })

    expect(
      parsePersonalizedReplyDraft({
        ...ENGLISH,
        output: { ...ENGLISH.output, replyText: 'A'.repeat(1_201) },
      }),
    ).toEqual({ status: 'rejected', reason: 'shape' })
  })
})
