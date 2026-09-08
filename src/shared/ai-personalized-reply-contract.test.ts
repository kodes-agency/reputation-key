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
  brandDisplayName: 'Example Hotel',
  output: {
    languageCode: 'en-Latn',
    replyText:
      'Thank you for sharing this. We are delighted that the quiet room and the kindness of our breakfast team made your stay at Example Hotel enjoyable.',
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
      brandDisplayName: 'Хотел Пример',
      output: {
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Благодарим ви за отзива за Хотел Пример. Радваме се, че тихата стая и любезният екип на закуска са допринесли за приятния ви престой.',
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
      'missing exact public Brand display name',
      {
        output: {
          ...ENGLISH.output,
          replyText: ENGLISH.output.replyText.replace('Example Hotel', 'our hotel'),
        },
      },
      'brand',
    ],
    [
      'case-changed public Brand display name',
      {
        output: {
          ...ENGLISH.output,
          replyText: ENGLISH.output.replyText.replace('Example Hotel', 'example hotel'),
        },
      },
      'brand',
    ],
    [
      'public Brand display name repeated twice',
      {
        output: {
          ...ENGLISH.output,
          replyText: `${ENGLISH.output.replyText} Thank you from Example Hotel.`,
        },
      },
      'brand',
    ],
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
            'Example Hotel ви благодари за обратната връзка. Признаваме вина и обещаваме обезщетение за бавното обслужване.',
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

  // Captured live: the model re-quoted its own sentence with a full stop where
  // the reply ends in an exclamation mark, and byte-exact self-quoting refused
  // the whole draft. The source side of that same pair was exact, so the reply
  // was genuinely grounded.
  it('accepts a draft whose reply excerpt drifts only in punctuation', () => {
    const result = parsePersonalizedReplyDraft({
      reviewText:
        'Имаме семеен хотел в центъра на Стара Загора. Препоръчвам на всички мои колеги!',
      rating: 5,
      targetLanguageTag: 'bg-Cyrl-BG',
      tone: 'professional',
      countryCode: 'BG',
      brandDisplayName: 'KODES agency',
      output: {
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Благодарим Ви за препоръката и за споделеното мнение! Радваме се, че KODES agency е бил полезен.',
        grounding: [
          {
            sourceExcerpt: 'Препоръчвам на всички мои колеги!',
            replyExcerpt: 'Благодарим Ви за препоръката и за споделеното мнение.',
          },
        ],
      },
    })
    expect(result.status).toBe('accepted')
  })

  // Also captured live: the model quoted a compressed form of its own opening
  // sentence. Every word it quoted is in the reply, and the source excerpt was
  // exact, so the draft is grounded.
  it('accepts a reply excerpt the model compressed from its own sentence', () => {
    const result = parsePersonalizedReplyDraft({
      reviewText:
        'Имаме семеен хотел в центъра на Стара Загора. Препоръчвам на всички мои колеги!',
      rating: 5,
      targetLanguageTag: 'bg-Cyrl-BG',
      tone: 'professional',
      countryCode: 'BG',
      brandDisplayName: 'KODES agency',
      output: {
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Благодарим Ви за високата оценка и препоръката! Радваме се, че KODES agency е бил полезен.',
        grounding: [
          {
            sourceExcerpt: 'Препоръчвам на всички мои колеги!',
            replyExcerpt: 'Благодарим Ви за препоръката!',
          },
        ],
      },
    })
    expect(result.status).toBe('accepted')
  })

  // A third live shape: the model quoted `услугите ни` while its reply credited
  // `услугите на KODES agency`. Grammar drift, same claim, exact source.
  it('accepts a reply excerpt that swaps a function word', () => {
    const result = parsePersonalizedReplyDraft({
      reviewText: 'Благодарение на услугите на агенцията, имаме повече трафик към сайта.',
      rating: 5,
      targetLanguageTag: 'bg-Cyrl-BG',
      tone: 'professional',
      countryCode: 'BG',
      brandDisplayName: 'KODES agency',
      output: {
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Радваме се, че услугите на KODES agency са допринесли за повече трафик към сайта.',
        grounding: [
          {
            sourceExcerpt: 'имаме повече трафик към сайта',
            replyExcerpt: 'услугите ни са допринесли за повече трафик към сайта',
          },
        ],
      },
    })
    expect(result.status).toBe('accepted')
  })

  // Tolerance covers the model's own words only: an excerpt padded with words
  // the reply never contains means the model quoted something it did not write.
  it('still rejects a reply excerpt containing words absent from the reply', () => {
    expect(
      parsePersonalizedReplyDraft({
        ...ENGLISH,
        output: {
          ...ENGLISH.output,
          grounding: [
            {
              sourceExcerpt: 'room was quiet',
              replyExcerpt: 'the room, which was quiet',
            },
          ],
        },
      }),
    ).toEqual({ status: 'rejected', reason: 'grounding' })
  })

  // The source side stays byte-exact: punctuation tolerance must not leak into
  // the anchor that proves the guest actually wrote the quoted words.
  it('keeps the source excerpt byte-exact against the review', () => {
    expect(
      parsePersonalizedReplyDraft({
        ...ENGLISH,
        output: {
          ...ENGLISH.output,
          grounding: [
            {
              sourceExcerpt: 'room was quiet.',
              replyExcerpt: 'quiet room',
            },
          ],
        },
      }),
    ).toEqual({ status: 'rejected', reason: 'grounding' })
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
