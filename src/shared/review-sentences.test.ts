import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  REVIEW_SENTENCES_DIGEST,
  REVIEW_SENTENCES_VERSION,
  locateReviewSentences,
  splitReviewSentences,
  type LocatedReviewSentence,
} from './review-sentences'

const sentenceCases = [
  ['CRLF', 'First.\r\nSecond!', ['First.', 'Second!']],
  ['blank lines', 'First.\n\n\nSecond', ['First.', 'Second']],
  [
    'outer whitespace',
    '  First sentence. Second sentence!  ',
    ['First sentence.', 'Second sentence!'],
  ],
  ['three dots', 'Wait... Next step.', ['Wait...', 'Next step.']],
  ['ellipsis run', 'Wait…… Next step.', ['Wait……', 'Next step.']],
  ['question and exclamation', 'Really?! Yes.', ['Really?!', 'Yes.']],
  ['Cyrillic', 'Чудесно! Но бавно.', ['Чудесно!', 'Но бавно.']],
  ['emoji', 'Lovely 😊. Slow 🐢!', ['Lovely 😊.', 'Slow 🐢!']],
  ['NBSP', 'Warm.\u00a0Quiet.', ['Warm.', 'Quiet.']],
  ['no final punctuation', 'One sentence only', ['One sentence only']],
  // The rule is typographic only: it knows nothing about abbreviations.
  ['abbreviation', 'Ask Dr. Smith. Thanks', ['Ask Dr.', 'Smith.', 'Thanks']],
  ['decimal point', 'It scored 4.5 stars. Lovely', ['It scored 4.5 stars.', 'Lovely']],
  ['empty', '', []],
  ['whitespace only', ' \t\n \r\n ', []],
  [
    'guide example',
    "The room was lovely but the air conditioning didn't work for two nights. Nobody came to fix it.",
    [
      "The room was lovely but the air conditioning didn't work for two nights.",
      'Nobody came to fix it.',
    ],
  ],
] as const

describe('review sentence rules', () => {
  it.each(sentenceCases)(
    'locates exactly the sentences split for %s',
    (_name, text, expected) => {
      const split = splitReviewSentences(text)
      const located = locateReviewSentences(text)

      expect(split).toEqual(expected)
      expect(located.map((sentence) => sentence.text)).toEqual(split)
      expect(located.map((sentence) => sentence.number)).toEqual(
        expected.map((_sentence, index) => index + 1),
      )
      for (const [index, sentence] of located.entries()) {
        expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text)
        expect(sentence.start).toBeLessThan(sentence.end)
        expect(sentence.start).toBeGreaterThanOrEqual(located[index - 1]?.end ?? 0)
        expect(Object.isFrozen(sentence)).toBe(true)
      }
      expect(Object.isFrozen(split)).toBe(true)
      expect(Object.isFrozen(located)).toBe(true)
    },
  )

  it('reports UTF-16 offsets around surrogate pairs', () => {
    const located: readonly LocatedReviewSentence[] =
      locateReviewSentences('  Good 😊.\nNext.')
    expect(located).toEqual([
      { number: 1, text: 'Good 😊.', start: 2, end: 10 },
      { number: 2, text: 'Next.', start: 11, end: 16 },
    ])
  })

  it('pins the browser-safe sentence-rule manifest digest', () => {
    const manifest = Object.freeze({
      version: 'review-sentences-v1',
      splitPatternSource: '(?<=[.!?…])\\s+|\\n+',
      splitPatternFlags: 'u',
      trim: true,
      dropEmpty: true,
      numbering: 'one-based',
    })
    expect(REVIEW_SENTENCES_VERSION).toBe('review-sentences-v1')
    expect(REVIEW_SENTENCES_DIGEST).toBe(
      'b7e81ba1117905c6ef567418dba1696af46fa11ab0b2a87c33100214b8fc451a',
    )
    expect(REVIEW_SENTENCES_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-review-sentences-v1\0', 'utf8')
        .update(canonicalizeRfc8785(manifest), 'utf8')
        .digest('hex'),
    )
  })
})
