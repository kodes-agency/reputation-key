import { describe, expect, it } from 'vitest'
import { parseGoogleReviewComment } from './google-review-comment'

describe('parseGoogleReviewComment', () => {
  it('splits the shape Google actually sends', () => {
    // Verbatim closed-beta row: a Bulgarian "Ок" whose English translation made
    // cld3 report reliable English.
    expect(
      parseGoogleReviewComment('(Translated by Google) Ok\n\n(Original)\nОк'),
    ).toEqual({ original: 'Ок', translation: 'Ok' })
  })

  it('keeps newlines inside both the translation and the original', () => {
    const comment =
      '(Translated by Google) Great room.\n\nQuiet street.\n\n(Original)\nСтаята е чудесна.\n\nУлицата е тиха.'

    expect(parseGoogleReviewComment(comment)).toEqual({
      original: 'Стаята е чудесна.\n\nУлицата е тиха.',
      translation: 'Great room.\n\nQuiet street.',
    })
  })

  it('reports no original when the prefix carries no (Original) marker', () => {
    expect(parseGoogleReviewComment('(Translated by Google) Lovely stay')).toEqual({
      original: null,
      translation: 'Lovely stay',
    })
  })

  it('returns an unwrapped comment as the original', () => {
    expect(parseGoogleReviewComment('Excellent stay')).toEqual({
      original: 'Excellent stay',
      translation: null,
    })
  })

  it('ignores the prefix when it appears mid-prose rather than as the envelope', () => {
    const comment = 'The menu said (Translated by Google) which was odd'

    expect(parseGoogleReviewComment(comment)).toEqual({
      original: comment,
      translation: null,
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns both parts null for %s', (_label, comment) => {
    expect(parseGoogleReviewComment(comment)).toEqual({
      original: null,
      translation: null,
    })
  })

  it.each([
    ['empty string', ''],
    ['whitespace only', '  \n\t '],
  ])('returns both parts null for an unwrapped %s', (_label, comment) => {
    expect(parseGoogleReviewComment(comment)).toEqual({
      original: null,
      translation: null,
    })
  })

  it('nulls a whitespace-only original after the marker', () => {
    expect(
      parseGoogleReviewComment('(Translated by Google) Ok\n\n(Original)\n   \n'),
    ).toEqual({ original: null, translation: 'Ok' })
  })

  it('nulls a whitespace-only translation before the marker', () => {
    expect(
      parseGoogleReviewComment('(Translated by Google)   \n\n(Original)\nОк'),
    ).toEqual({ original: 'Ок', translation: null })
  })

  // Documented rule: the FIRST (Original) after the prefix is the delimiter, so
  // a later literal (Original) in the guest's prose stays inside `original` and
  // no guest character is lost.
  it('splits on the first marker and keeps a literal (Original) in the original text', () => {
    const comment =
      '(Translated by Google) Ok\n\n(Original)\nОк, вижте (Original) по-долу\n\n(Original)\nкрай'

    expect(parseGoogleReviewComment(comment)).toEqual({
      original: 'Ок, вижте (Original) по-долу\n\n(Original)\nкрай',
      translation: 'Ok',
    })
  })

  it('splits on the first marker even when the translation quotes it in prose', () => {
    const comment =
      '(Translated by Google) They wrote (Original) on the receipt\n\n(Original)\nНаписаха (Original) на бележката'

    expect(parseGoogleReviewComment(comment)).toEqual({
      original: 'on the receipt\n\n(Original)\nНаписаха (Original) на бележката',
      translation: 'They wrote',
    })
  })
})
