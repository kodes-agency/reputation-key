import { describe, expect, it } from 'vitest'
import {
  collectReviewNameTokens,
  collectVocabularyHintWords,
  managerCauseRefusal,
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
  it('collects every capitalized word and compound parts', () => {
    const tokens = collectReviewNameTokens([
      'Yesterday we met Maria near reception.',
      'Later we thanked Jean-Paul and O’Connor warmly.',
    ])
    expect([...tokens].sort()).toEqual([
      'connor',
      'jean',
      'jean-paul',
      'later',
      'maria',
      'o',
      'o’connor',
      'paul',
      'yesterday',
    ])
  })

  it('finds a name that opens a sentence, in the first sentence or a later one', () => {
    const tokens = collectReviewNameTokens([
      'Maria at reception was lovely.',
      'The room was clean.',
      'Hilton staff were lovely.',
    ])
    expect([...tokens].sort()).toEqual(['hilton', 'maria', 'the'])
  })

  it('ignores one-letter words', () => {
    const tokens = collectReviewNameTokens(['We met A by reception.'])
    expect([...tokens]).toEqual(['we'])
  })

  it('reads short and partly lower-case sentences as written', () => {
    const tokens = collectReviewNameTokens([
      'Thank you Maria!',
      'Thanks Maria and John!',
      'Lovely Hilton Marina Bay stay.',
    ])
    expect([...tokens].sort()).toEqual([
      'bay',
      'hilton',
      'john',
      'lovely',
      'maria',
      'marina',
      'thank',
      'thanks',
    ])
  })

  it('reads title-case and shouting sentences as written, headings included', () => {
    const tokens = collectReviewNameTokens([
      'Great Location Friendly Staff',
      'HILTON MARINA BAY HOTEL',
    ])
    expect([...tokens].sort()).toEqual([
      'bay',
      'friendly',
      'great',
      'hilton',
      'hotel',
      'location',
      'marina',
      'staff',
    ])
  })

  it('ignores redaction placeholders and reads the words around them', () => {
    const tokens = collectReviewNameTokens([
      'The host [PERSON] was kind to Maria.',
      'Write to [CONTACT] or [ADDRESS] soon.',
    ])
    expect([...tokens].sort()).toEqual(['maria', 'the', 'write'])
  })

  it('drops a candidate also written entirely in lowercase', () => {
    const tokens = collectReviewNameTokens([
      'We happily met Maria today.',
      'Later maria returned with towels.',
    ])
    expect(tokens.has('maria')).toBe(false)
  })

  it('drops a sentence-initial word the review also writes in lowercase', () => {
    const tokens = collectReviewNameTokens(['Staff were lovely.', 'The staff helped.'])
    expect(tokens.has('staff')).toBe(false)
  })

  it('returns a fresh set on every call', () => {
    const first = collectReviewNameTokens(['We met Maria today.'])
    const second = collectReviewNameTokens(['We met Maria today.'])
    expect([...first]).toEqual(['we', 'maria'])
    expect([...second]).toEqual(['we', 'maria'])
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

// S5 (switch-on): a cause a manager types passes the guards an AI's cause passes.
describe('manager-typed cause refusal', () => {
  const REVIEW = 'The room was lovely but Maria at reception was slow with the keys.'
  const allowedWords = new Set(['the', 'room', 'slow', 'front', 'desk'])

  it.each([
    ['a name typed with a capital', ['Maria', 'slow'], 'maria', 'slow'],
    [
      'a name typed with a capital in the second box',
      ['desk', 'Petrova'],
      'desk',
      'petrova',
    ],
    ['a name inside a longer phrase', ['rude Maria', null], 'rude maria', null],
  ])('refuses %s as a name, with or without the review', (_name, typed, thing, issue) => {
    for (const reviewText of [null, REVIEW]) {
      expect(managerCauseRefusal({ typed, thing, issue, reviewText, allowedWords })).toBe(
        'name',
      )
    }
  })

  it('refuses the name the review writes with a capital, typed in lowercase', () => {
    expect(
      managerCauseRefusal({
        typed: ['maria', 'slow'],
        thing: 'maria',
        issue: 'slow',
        reviewText: REVIEW,
        allowedWords,
      }),
    ).toBe('name')
  })

  it('lets a lowercase word through when the review is not readable and no capital was typed', () => {
    // The raw text is served for 30 days; once gone, only the capitals rule applies.
    expect(
      managerCauseRefusal({
        typed: ['maria', 'slow'],
        thing: 'maria',
        issue: 'slow',
        reviewText: null,
        allowedWords,
      }),
    ).toBeNull()
  })

  it('lets a capitalised common word through, the way a person starts a sentence', () => {
    expect(
      managerCauseRefusal({
        typed: ['Front desk', 'Slow'],
        thing: 'front desk',
        issue: 'slow',
        reviewText: REVIEW,
        allowedWords,
      }),
    ).toBeNull()
  })

  it('refuses four or more contiguous words of the review across the two boxes', () => {
    expect(
      managerCauseRefusal({
        typed: ['reception was', 'slow with'],
        thing: 'reception was',
        issue: 'slow with',
        reviewText: REVIEW,
        allowedWords: new Set(['reception', 'was', 'slow', 'with']),
      }),
    ).toBe('quotation')
  })

  it('allows three words of the review, and any cause when the review is not readable', () => {
    expect(
      managerCauseRefusal({
        typed: ['reception', 'was slow'],
        thing: 'reception',
        issue: 'was slow',
        reviewText: REVIEW,
        allowedWords: new Set(['reception', 'was', 'slow']),
      }),
    ).toBeNull()
    expect(
      managerCauseRefusal({
        typed: ['reception was', 'slow with'],
        thing: 'reception was',
        issue: 'slow with',
        reviewText: null,
        allowedWords: new Set(['reception', 'was', 'slow', 'with']),
      }),
    ).toBeNull()
  })

  it('accepts an empty cause', () => {
    expect(
      managerCauseRefusal({
        typed: [null, null],
        thing: null,
        issue: null,
        reviewText: REVIEW,
        allowedWords,
      }),
    ).toBeNull()
  })
})
