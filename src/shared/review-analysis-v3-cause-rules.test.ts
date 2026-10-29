import { describe, expect, it } from 'vitest'
import {
  collectReviewNameTokens,
  collectVocabularyHintWords,
  normalizeReviewCausePhrase,
  reviewCauseContainsRefusedName,
  reviewCauseReproducesQuotation,
  type NormalizedReviewCausePhrase,
} from './review-analysis-v3-cause-rules'

describe('review analysis v3 cause shape', () => {
  it('normalizes compatibility forms, dash variants, casing and whitespace', () => {
    const variants = ['‐', '‑', '‒', '–', '—', '―', '−', '﹘', '﹣', '－']
    for (const dash of variants) {
      expect(normalizeReviewCausePhrase(`  CHECK${dash}IN\tQUEUE  `)).toEqual({
        valid: true,
        value: 'check-in queue',
      })
    }
    expect(normalizeReviewCausePhrase('ＡＩＲ conditioning')).toEqual({
      valid: true,
      value: 'air conditioning',
    })
    const nullable = normalizeReviewCausePhrase(null)
    expect(nullable).toEqual({ valid: true, value: null })
    expect(Object.isFrozen(nullable)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['wrong type', 42],
    ['too long', 'a'.repeat(81)],
    ['four tokens', 'one two three four'],
    ['digits', 'room 2'],
    ['punctuation', 'air/conditioning'],
    ['non-English letters', 'климатик'],
  ])('rejects a cause with %s without truncating it', (_name, value) => {
    const result: NormalizedReviewCausePhrase = normalizeReviewCausePhrase(value)
    expect(result).toEqual({ valid: false })
  })
})

describe('review name-token collection', () => {
  it('collects non-initial capitalized words and compound parts', () => {
    const tokens = collectReviewNameTokens([
      'Yesterday we met Maria near reception.',
      'Later we thanked Jean-Paul and O’Connor warmly.',
    ])
    expect([...tokens].sort()).toEqual([
      'connor',
      'jean',
      'jean-paul',
      'maria',
      'o',
      'o’connor',
      'paul',
    ])
  })

  it('ignores sentence-initial, one-letter, title-case and shouting candidates', () => {
    const tokens = collectReviewNameTokens([
      'Maria helped us today.',
      'We met A by reception.',
      'Wonderful Friendly Helpful Team',
      'GREAT STAFF MARIA HELPED',
    ])
    expect([...tokens]).toEqual([])
  })

  it('reads short and partly lower-case sentences as written', () => {
    const tokens = collectReviewNameTokens([
      'Thank you Maria!',
      'Thanks Maria and John!',
      'Lovely Hilton Marina Bay stay.',
    ])
    expect([...tokens].sort()).toEqual(['bay', 'hilton', 'john', 'maria', 'marina'])
  })

  it('treats a sentence of four or more capitalized words as a heading', () => {
    const tokens = collectReviewNameTokens([
      'Great Location Friendly Staff',
      'SUPER CLEAN ROOMS HERE',
    ])
    expect([...tokens]).toEqual([])
    const almost = collectReviewNameTokens(['Great Location and Friendly Staff'])
    expect([...almost].sort()).toEqual(['friendly', 'location', 'staff'])
  })

  it('ignores redaction placeholders and reads the words around them', () => {
    const tokens = collectReviewNameTokens([
      'The host [PERSON] was kind to Maria.',
      'Write to [CONTACT] or [ADDRESS] soon.',
    ])
    expect([...tokens]).toEqual(['maria'])
  })

  it('drops a candidate also written entirely in lowercase', () => {
    const tokens = collectReviewNameTokens([
      'We happily met Maria today.',
      'Later maria returned with towels.',
    ])
    expect(tokens.has('maria')).toBe(false)
  })

  it('returns a fresh set on every call', () => {
    const first = collectReviewNameTokens(['We met Maria today.'])
    const second = collectReviewNameTokens(['We met Maria today.'])
    expect([...first]).toEqual(['maria'])
    expect([...second]).toEqual(['maria'])
    expect(first).not.toBe(second)
  })
})

describe('review vocabulary hints', () => {
  it('collects NFKC-lowercased letter runs from every topic hint', () => {
    const words = collectVocabularyHintWords({
      facilities_equipment: ['ＡＩＲ-conditioning', 'Wi-Fi unit'],
      main_service: ['Massage pressure'],
    })
    expect([...words].sort()).toEqual([
      'air',
      'conditioning',
      'fi',
      'massage',
      'pressure',
      'unit',
      'wi',
    ])
  })

  it('returns an empty set when hints are absent', () => {
    const words = collectVocabularyHintWords(undefined)
    expect([...words]).toEqual([])
  })
})

describe('review cause name refusal', () => {
  it('refuses a whole name token or one of its hyphen parts', () => {
    const input = {
      issue: 'not working',
      nameTokens: new Set(['marina-bay', 'marina', 'bay']),
      allowedWords: new Set<string>(),
    } as const
    expect(reviewCauseContainsRefusedName({ ...input, thing: 'marina' })).toBe(true)
    expect(reviewCauseContainsRefusedName({ ...input, thing: 'bay room' })).toBe(true)
  })

  it('allows a capitalized common word and a governed hint word', () => {
    const nameTokens = new Set(['air', 'hydrojet'])
    expect(
      reviewCauseContainsRefusedName({
        thing: 'air conditioning',
        issue: 'not working',
        nameTokens,
        allowedWords: new Set(['air']),
      }),
    ).toBe(false)
    expect(
      reviewCauseContainsRefusedName({
        thing: 'hydrojet',
        issue: 'too weak',
        nameTokens,
        allowedWords: new Set(['hydrojet']),
      }),
    ).toBe(false)
  })
})

describe('review cause quotation refusal', () => {
  it('allows three copied words across thing and issue', () => {
    expect(
      reviewCauseReproducesQuotation({
        thing: 'air conditioning',
        issue: 'failed',
        reviewText: 'The air conditioning failed overnight.',
      }),
    ).toBe(false)
  })

  it('refuses four copied contiguous words across thing and issue', () => {
    expect(
      reviewCauseReproducesQuotation({
        thing: 'air conditioning',
        issue: 'didnt work',
        reviewText: "The air-conditioning didn't work overnight.",
      }),
    ).toBe(true)
  })

  it('checks every four-word window in a six-word cause', () => {
    expect(
      reviewCauseReproducesQuotation({
        thing: 'front desk queue',
        issue: 'was very slow',
        reviewText: 'Sadly the desk queue was very slow each morning.',
      }),
    ).toBe(true)
  })

  it('always allows a single verbatim thing or issue', () => {
    expect(
      reviewCauseReproducesQuotation({
        thing: 'air conditioning',
        issue: null,
        reviewText: 'The air conditioning was fine.',
      }),
    ).toBe(false)
    expect(
      reviewCauseReproducesQuotation({
        thing: null,
        issue: 'not working',
        reviewText: 'It was not working.',
      }),
    ).toBe(false)
  })
})
