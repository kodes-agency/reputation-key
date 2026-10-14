import { describe, expect, it } from 'vitest'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
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

  // Measured live: of the four real reviews on the beta property that name the
  // business, three spell it `Kodes`/`kodes` rather than `KODES agency`, and the
  // prompt tells the model to ground itself in the guest's words. The reply
  // still carries the approved identity.
  it('accepts the approved display name in the casing the guest used', () => {
    const result = parsePersonalizedReplyDraft({
      ...ENGLISH,
      brandDisplayName: 'KODES agency',
      output: {
        ...ENGLISH.output,
        replyText:
          'Thank you for sharing this. The Kodes Agency team is glad the quiet room and the kindness of our breakfast team made your stay enjoyable.',
        grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
      },
    })
    expect(result.status).toBe('accepted')
  })

  // Opening with the business name and signing off with it is the most ordinary
  // hospitality shape there is; it used to be refused for being too on-brand.
  it('accepts a reply that names the business more than once', () => {
    const result = parsePersonalizedReplyDraft({
      ...ENGLISH,
      output: {
        ...ENGLISH.output,
        replyText:
          'Example Hotel thanks you for this. We are glad the quiet room and the kindness of our breakfast team made your stay enjoyable. The Example Hotel team',
        grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
      },
    })
    expect(result.status).toBe('accepted')
  })

  it('still refuses a reply that never names the business', () => {
    expect(
      parsePersonalizedReplyDraft({
        ...ENGLISH,
        output: {
          ...ENGLISH.output,
          replyText:
            'Thank you for sharing this. We are delighted that the quiet room and the kindness of our breakfast team made your stay enjoyable.',
          grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
        },
      }),
    ).toEqual({ status: 'rejected', reason: 'brand' })
  })

  // 4 of the 20 real reviews carry U+2019; one carries a newline inside the
  // sentence a grounding excerpt has to span.
  it('accepts a source excerpt that differs only in apostrophe shape or line breaks', () => {
    const result = parsePersonalizedReplyDraft({
      ...ENGLISH,
      reviewText: 'Great SEO services!\nI\u2019m extremely satisfied with the team.',
      output: {
        ...ENGLISH.output,
        replyText:
          'Thank you - we are glad you are extremely satisfied with the team at Example Hotel.',
        grounding: [
          {
            sourceExcerpt: "services! I'm extremely satisfied with the team",
            replyExcerpt: 'extremely satisfied with the team',
          },
        ],
      },
    })
    expect(result.status).toBe('accepted')
  })

  // A display name carrying a digit or an ampersand used to make two contracts
  // mutually unsatisfiable: the brand rule required the string, the leakage
  // scanner refused digits and symbols, so no output could ever be accepted.
  it('accepts a display name whose characters the leakage scanner forbids elsewhere', () => {
    const result = parsePersonalizedReplyDraft({
      ...ENGLISH,
      brandDisplayName: 'Rooms 24 & Co',
      output: {
        ...ENGLISH.output,
        replyText:
          'Thank you for sharing this. Rooms 24 & Co is glad the quiet room and the kindness of our breakfast team made your stay enjoyable.',
        grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
      },
    })
    expect(result.status).toBe('accepted')
  })

  it('still refuses forbidden characters the model added on its own', () => {
    expect(
      parsePersonalizedReplyDraft({
        ...ENGLISH,
        brandDisplayName: 'Rooms 24 & Co',
        output: {
          ...ENGLISH.output,
          replyText:
            'Thank you for sharing this. Rooms 24 & Co is glad the quiet room pleased you; reach us at team@example.com any time.',
          grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
        },
      }),
    ).toEqual({ status: 'rejected', reason: 'prohibited_content' })
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

function englishReplyWith(sentence: string) {
  return parsePersonalizedReplyDraft({
    ...ENGLISH,
    output: {
      ...ENGLISH.output,
      replyText: `Thank you for sharing this. ${sentence} Example Hotel is glad the quiet room pleased you.`,
      grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
    },
  })
}

function bulgarianReplyWith(sentence: string) {
  return parsePersonalizedReplyDraft({
    reviewText: 'Стаята беше тиха, а екипът на закуска беше много любезен.',
    rating: 5,
    targetLanguageTag: 'bg-Cyrl-BG',
    tone: 'professional',
    countryCode: 'BG',
    brandDisplayName: 'Хотел Пример',
    output: {
      languageCode: 'bg-Cyrl-BG',
      replyText: `Хотел Пример ви благодари за отзива. ${sentence} Радваме се, че тихата стая ви хареса.`,
      grounding: [{ sourceExcerpt: 'Стаята беше тиха', replyExcerpt: 'тихата стая' }],
    },
  })
}

describe('compensation, promise and admission filter', () => {
  it.each([
    'Any extra costs have been refunded.',
    'Refunds will be issued this week.',
    'We are refunding the difference.',
    'We have reimbursed you in full.',
    'We offer reimbursement for the taxi.',
    'You will get two free nights next time.',
    'There will be free meals for everyone.',
    'We will give you free upgrades on arrival.',
    'We are compensating you for the noise.',
    'That is guaranteed from now on.',
    'We promised to look into it.',
    'Our team was at fault here.',
  ])('rejects the English reply sentence "%s"', (sentence) => {
    expect(englishReplyWith(sentence)).toEqual({
      status: 'rejected',
      reason: 'prohibited_content',
    })
  })

  it.each([
    'Ще ви възстановим сумата още днес.',
    'Ще ви възстановим парите за престоя.',
    'Ще Ви върнем парите утре.',
    'Ще ви върнем сумата по сметката.',
    'Предлагаме ви безплатна нощувка.',
    'Предлагаме безплатен престой при следващо посещение.',
    'Получавате безплатни нощувки.',
    'Получавате безплатно хранене.',
    'Предлагаме безплатен ъпгрейд на стаята.',
    'Признаваме вината си за случилото се.',
    'Признаваме, че това е наша вина.',
    'Започваме процедура по възстановяване на сумата.',
    'Ще ви компенсираме за неудобството.',
    'Гарантираме ви пълна тишина.',
    'Управителят гарантира, че това няма да се повтори.',
    'Обещаваме да се подобрим.',
    'Давам ви обещание за промяна.',
    'Ще ви изплатим обезщетение.',
  ])('rejects the Bulgarian reply sentence "%s"', (sentence) => {
    expect(bulgarianReplyWith(sentence)).toEqual({
      status: 'rejected',
      reason: 'prohibited_content',
    })
  })

  it.each([
    'We are glad the free breakfast was enjoyable.',
    'The staff will pass your kind words on to the whole team.',
    'We hope to welcome you again soon.',
  ])('accepts the ordinary English reply sentence "%s"', (sentence) => {
    expect(englishReplyWith(sentence).status).toBe('accepted')
  })

  it.each([
    'Благодарим ви за добрите думи към екипа.',
    'Ще предадем отзива ви на колегите от рецепцията.',
    'Надяваме се скоро отново да ви посрещнем.',
    'Закуската ни е гордост и се радваме, че ви хареса.',
  ])('accepts the ordinary Bulgarian reply sentence "%s"', (sentence) => {
    expect(bulgarianReplyWith(sentence).status).toBe('accepted')
  })

  it('records the patterns in the profile digest, not only how many there are', () => {
    // The first generation digested `prohibitedPatternCount: 3`, so repairing the
    // patterns changed neither the profile nor its digest.
    expect(AI_PERSONALIZED_REPLY_PROFILE_DIGEST).not.toBe(
      'e96cfa2f6e89fb88201bc4e37779ee53e393ee1bba1d422cc030d67c91726869',
    )
  })
})

describe('the approved display name is exempt from the leakage scan however the reply cases it', () => {
  const RESERVED_NAME = 'Rooms 24 & Co'

  function replyNaming(spelling: string) {
    return parsePersonalizedReplyDraft({
      ...ENGLISH,
      brandDisplayName: RESERVED_NAME,
      output: {
        ...ENGLISH.output,
        replyText: `Thank you for sharing this. ${spelling} is glad the quiet room and the kindness of our breakfast team made your stay enjoyable.`,
        grounding: [{ sourceExcerpt: 'room was quiet', replyExcerpt: 'quiet room' }],
      },
    })
  }

  it.each([
    ['exactly', 'Rooms 24 & Co'],
    ['in capitals', 'ROOMS 24 & CO'],
    ['in lower case', 'rooms 24 & co'],
    ['with a wider gap', 'Rooms  24  &  Co'],
  ])('accepts the name written %s', (_how, spelling) => {
    expect(replyNaming(spelling).status).toBe('accepted')
  })

  it('still refuses digits and symbols the model added beside the name', () => {
    expect(replyNaming('ROOMS 24 & CO (open 24 hours)')).toEqual({
      status: 'rejected',
      reason: 'prohibited_content',
    })
  })
})
