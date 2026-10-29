import { describe, expect, it } from 'vitest'
import {
  AiReviewSourceRefusal,
  MAX_AI_REVIEW_SENTENCES_V1,
  canonicalizeRawAiReviewSentences,
  canonicalizeRawAiReviewSource,
  type RawAiReviewSource,
} from './ai-review-source-contract'
import { locateReviewSentences, splitReviewSentences } from './review-sentences'

function raw(text: string | null, reviewerDisplayName: string | null = null) {
  return {
    text,
    rating: 4,
    languageCode: 'en',
    reviewedAtEpochMillis: 1_780_000_000_000,
    reviewerDisplayName,
  } satisfies RawAiReviewSource
}

const comparable = (value: string): string =>
  value.replaceAll('[PERSON]', '').replace(/\s+/gu, '')

const corpus = [
  'The room was lovely but the air conditioning did not work. Nobody came to fix it.',
  'Great room\nTerrible bar. Nice staff!',
  'Stay was fine…\nBreakfast, though… could be better.\n\n\nWould return.',
  'Чудесно! Но бавно.\r\nБарът беше шумен?! Да.',
  'One sentence only',
  '  Spaces   around.   And   inside.  ',
  'Ask Dr. Smith. Thanks',
  'Tab\tseparated words. Second\u00a0sentence.\u2028Third line',
  'Emoji 😊. Slow 🐢!',
  'Fullwidth！ Stop． Next ？ Done',
  'A.\nB.\nC.',
] as const

describe('canonicalizeRawAiReviewSentences', () => {
  it.each(corpus)('numbers the RAW text exactly as the live display does: %j', (text) => {
    const sentences = canonicalizeRawAiReviewSentences(raw(text))
    const located = locateReviewSentences(text)

    expect(sentences.map(({ number }) => number)).toEqual(
      located.map(({ number }) => number),
    )
    expect(sentences).toHaveLength(splitReviewSentences(text).length)
    for (const [index, sentence] of sentences.entries()) {
      expect(sentence.number).toBe(index + 1)
      expect(Object.isFrozen(sentence)).toBe(true)
      // The provider reads sentence n where the display underlines sentence n.
      expect(comparable(sentence.text)).toBe(
        comparable(canonicalizeRawAiReviewSource(raw(located[index]!.text)).text ?? ''),
      )
    }
    expect(Object.isFrozen(sentences)).toBe(true)
  })

  it.each(corpus)('says the same words as the whole canonical text: %j', (text) => {
    const sentences = canonicalizeRawAiReviewSentences(raw(text))
    const whole = canonicalizeRawAiReviewSource(raw(text)).text ?? ''

    expect(comparable(sentences.map(({ text: part }) => part).join(' '))).toBe(
      comparable(whole),
    )
  })

  it('splits before line breaks are flattened, which is why the whole text cannot be numbered', () => {
    const text = 'Great room\nTerrible bar. Nice staff!'
    const whole = canonicalizeRawAiReviewSource(raw(text)).text ?? ''

    expect(whole).toBe('Great room Terrible bar. Nice staff!')
    expect(splitReviewSentences(whole)).toHaveLength(2)
    expect(
      canonicalizeRawAiReviewSentences(raw(text)).map(({ text: part }) => part),
    ).toEqual(['Great room', 'Terrible bar.', 'Nice staff!'])
  })

  it('normalizes each sentence the way the whole text is normalized', () => {
    const sentences = canonicalizeRawAiReviewSentences(
      raw('Ｗｏｗ\u200e! ＮＩＣＥ\tplace. Fine\u0007.'),
    )

    // NFKC folds the full-width letters, controls and bidi marks go, a tab is a space.
    expect(sentences.map(({ text }) => text)).toEqual(['Wow!', 'NICE place.', 'Fine.'])
  })

  it('numbers by the raw rule, so a full-width stop is no boundary the display knows', () => {
    const text = 'Wow！ Nice place． Fine.'
    const located = locateReviewSentences(text)

    expect(located).toHaveLength(1)
    // NFKC would make "！ " a stop-and-space, but the display never sees that.
    expect(canonicalizeRawAiReviewSentences(raw(text))).toEqual([
      { number: 1, text: 'Wow! Nice place. Fine.' },
    ])
  })

  it('keeps the number of a sentence that normalizes to nothing', () => {
    const sentences = canonicalizeRawAiReviewSentences(
      raw('First.\n\u0007\u0008\nThird.'),
    )

    expect(sentences).toEqual([
      { number: 1, text: 'First.' },
      { number: 2, text: '' },
      { number: 3, text: 'Third.' },
    ])
  })

  it('returns nothing for a review without text', () => {
    expect(canonicalizeRawAiReviewSentences(raw(null))).toEqual([])
    expect(canonicalizeRawAiReviewSentences(raw(''))).toEqual([])
    expect(canonicalizeRawAiReviewSentences(raw(' \n\t '))).toEqual([])
  })

  describe('reviewer identity', () => {
    it('masks the reviewer name where it stands, as the whole text does', () => {
      const text = 'Maria was great. Ask maria again. Nothing else.'
      const sentences = canonicalizeRawAiReviewSentences(raw(text, 'Maria'))
      const whole = canonicalizeRawAiReviewSource(raw(text, 'Maria')).text

      expect(sentences.map(({ text: part }) => part)).toEqual([
        '[PERSON] was great.',
        'Ask [PERSON] again.',
        'Nothing else.',
      ])
      expect(whole).toBe('[PERSON] was great. Ask [PERSON] again. Nothing else.')
      expect(sentences.map(({ text: part }) => part).join(' ')).toBe(whole)
    })

    it('masks a name that holds a sentence-ending stop in every sentence it touches', () => {
      const text = 'We asked Dr. Smith about it. He agreed.'
      const sentences = canonicalizeRawAiReviewSentences(raw(text, 'Dr. Smith'))

      // The whole text masks "Dr. Smith" once; the numbering keeps one marker per sentence.
      expect(canonicalizeRawAiReviewSource(raw(text, 'Dr. Smith')).text).toBe(
        'We asked [PERSON] about it. He agreed.',
      )
      expect(sentences.map(({ text: part }) => part)).toEqual([
        'We asked [PERSON]',
        '[PERSON] about it.',
        'He agreed.',
      ])
      for (const sentence of sentences) {
        expect(sentence.text).not.toMatch(/Smith|Dr\./u)
      }
    })

    it('masks every sentence a long name covers whole', () => {
      const sentences = canonicalizeRawAiReviewSentences(
        raw('Ask Mr. A. B. Kim now.', 'Mr. A. B. Kim'),
      )

      expect(sentences.map(({ text }) => text)).toEqual([
        'Ask [PERSON]',
        '[PERSON]',
        '[PERSON]',
        '[PERSON] now.',
      ])
    })

    it('matches the name through case folding and normalization forms', () => {
      const sentences = canonicalizeRawAiReviewSentences(
        raw('ЙОРДАН was kind. Ｊｏｒｄａｎ too.', 'Йордан'),
      )

      expect(sentences.map(({ text }) => text)).toEqual([
        '[PERSON] was kind.',
        'Ｊｏｒｄａｎ too.'.normalize('NFKC'),
      ])
    })

    it('never lets a guest type a closed placeholder into a sentence', () => {
      const sentences = canonicalizeRawAiReviewSentences(
        raw('Call [CONTACT] now. See [PERSON] there.', 'Someone Else'),
      )

      expect(sentences.map(({ text }) => text)).toEqual([
        'Call {#2#} now.',
        'See {#1#} there.',
      ])
    })

    it('agrees with the whole text on how many names it masks when none crosses a boundary', () => {
      const text = 'Anna helped us.\nAnna was kind. We thank Anna!'
      const sentences = canonicalizeRawAiReviewSentences(raw(text, 'Anna'))
      const whole = canonicalizeRawAiReviewSource(raw(text, 'Anna')).text ?? ''
      const count = (value: string) => value.split('[PERSON]').length - 1

      expect(count(sentences.map(({ text: part }) => part).join(' '))).toBe(count(whole))
      expect(count(whole)).toBe(3)
    })
  })

  describe('bounds', () => {
    it('refuses a text with more sentences than the evidence request carries', () => {
      const atTheLimit = Array.from(
        { length: MAX_AI_REVIEW_SENTENCES_V1 },
        () => 'a.',
      ).join('\n')
      const overTheLimit = `${atTheLimit}\nb.`

      expect(canonicalizeRawAiReviewSentences(raw(atTheLimit))).toHaveLength(
        MAX_AI_REVIEW_SENTENCES_V1,
      )
      expect(() => canonicalizeRawAiReviewSentences(raw(overTheLimit))).toThrow(
        AiReviewSourceRefusal,
      )
    })

    it('refuses the raw sources the whole text refuses', () => {
      expect(() =>
        canonicalizeRawAiReviewSentences(raw('Lone \ud800 surrogate.')),
      ).toThrow(AiReviewSourceRefusal)
      expect(() => canonicalizeRawAiReviewSentences(raw('a'.repeat(70_000)))).toThrow(
        AiReviewSourceRefusal,
      )
      expect(() =>
        canonicalizeRawAiReviewSentences(raw('Fine.', 'Lone \ud800 name')),
      ).toThrow(AiReviewSourceRefusal)
    })

    it('refuses sentences that together pass the canonical byte limit', () => {
      const sentence = `${'é'.repeat(900)}.`
      const text = Array.from({ length: 12 }, () => sentence).join('\n')

      expect(() => canonicalizeRawAiReviewSentences(raw(text))).toThrow(
        AiReviewSourceRefusal,
      )
    })
  })
})
