import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewSentences,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'
import { reviewRedactionsAgree } from './review-analysis-v3-request'

const profile = {
  expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
  expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
  expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
} as const

function redactSentences(sentences: readonly string[], countryCode = 'US') {
  return redactAiReviewSentences({ sentences, countryCode, ...profile })
}

function redactWhole(text: string, countryCode = 'US') {
  return redactAiReviewText({ text, countryCode, ...profile })
}

describe('redactAiReviewSentences', () => {
  it('replaces a marker inside the sentence that holds it and leaves the others alone', () => {
    const result = redactSentences([
      'The room was lovely.',
      'Write to owner@example.com for details.',
      'We will be back.',
    ])

    expect(result).toMatchObject({
      status: 'redacted',
      sentences: [
        'The room was lovely.',
        'Write to [CONTACT] for details.',
        'We will be back.',
      ],
      counts: { '[CONTACT]': 1, '[PERSON]': 0 },
    })
  })

  it('keeps one output per input, whatever is removed, so sentence numbers never move', () => {
    const result = redactSentences(['First.', '', 'a@b.co', 'Fourth.'])

    expect(result.status === 'redacted' && result.sentences).toEqual([
      'First.',
      '',
      '[CONTACT]',
      'Fourth.',
    ])
  })

  it('counts the redacted share over the whole review, as the whole text does', () => {
    const review = [
      'Lovely quiet room with a view of the harbour.',
      'The staff were kind and the bed was comfortable!',
      'owner@example.com',
    ]

    // A sentence that is only an address is past three fifths on its own ...
    expect(redactWhole(review[2]!)).toMatchObject({
      status: 'redaction_blocked',
      reason: 'redaction_ratio_exceeded',
    })
    // ... but the review is not, and a review is what is bounded.
    expect(redactWhole(review.join(' ')).status).toBe('redacted')
    expect(redactSentences(review)).toMatchObject({
      status: 'redacted',
      sentences: [review[0], review[1], '[CONTACT]'],
    })
  })

  it('refuses a review whose redacted share passes three fifths over all its sentences', () => {
    expect(redactSentences(['owner@example.com', 'owner@example.org', 'ok'])).toEqual({
      status: 'redaction_blocked',
      reason: 'redaction_ratio_exceeded',
    })
  })

  it('refuses a review with more than 64 intervals over all its sentences', () => {
    const sentences = Array.from({ length: 65 }, (_, index) => `n${index}@ex.com is ok`)
    expect(
      redactSentences([
        ...sentences,
        ...Array.from({ length: 65 }, () => 'x'.repeat(60)),
      ]),
    ).toEqual({ status: 'redaction_blocked', reason: 'candidate_limit_exceeded' })
  })

  it('counts source-attested person markers toward the same limits', () => {
    const result = redactSentences(['Thanks [PERSON].', 'Ask [PERSON] about it.'])

    expect(result).toMatchObject({
      status: 'redacted',
      sentences: ['Thanks [PERSON].', 'Ask [PERSON] about it.'],
      counts: { '[PERSON]': 2 },
    })
  })

  it('refuses a closed placeholder the guest typed into any sentence', () => {
    expect(redactSentences(['Fine.', 'Call [CONTACT] now.'])).toEqual({
      status: 'redaction_blocked',
      reason: 'forbidden_source_placeholder',
    })
  })

  it('refuses a sentence the scanner cannot read as canonical', () => {
    expect(redactSentences(['Fine.', 'Ｗｉｄｅ text.'])).toEqual({
      status: 'redaction_blocked',
      reason: 'noncanonical_unicode',
    })
  })

  it('refuses a profile it does not hold, before it reads a sentence', () => {
    for (const mismatch of [
      { expectedRedactionProfileVersion: 'other' },
      { expectedRedactionProfileDigest: '0'.repeat(64) },
      { expectedDetectorProfileVersion: 'other' },
      { expectedDetectorProfileDigest: '0'.repeat(64) },
    ]) {
      expect(
        redactAiReviewSentences({
          sentences: ['Fine.'],
          countryCode: 'US',
          ...profile,
          ...mismatch,
        }),
      ).toEqual({ status: 'redaction_blocked', reason: 'profile_mismatch' })
    }
  })

  it('redacts nothing from a review with no sentences', () => {
    expect(redactSentences([])).toMatchObject({ status: 'redacted', sentences: [] })
  })

  it('reads a marker a line break cut in two as the one marker it is', () => {
    const sentences = ['Phone +359 888', '123 456 anytime.']
    const whole = redactWhole(sentences.join(' '), 'BG')

    expect(whole).toMatchObject({ status: 'redacted', text: 'Phone [CONTACT] anytime.' })
    // Read apart, neither half is a phone number. Read together it is one, and
    // each sentence it touches loses its half, so no half reaches a provider.
    expect(redactSentences(sentences, 'BG')).toMatchObject({
      status: 'redacted',
      sentences: ['Phone [CONTACT]', '[CONTACT] anytime.'],
      counts: { '[CONTACT]': 1 },
    })
    expect(redactSentences(sentences, 'BG')).toMatchObject({
      sentences: expect.not.arrayContaining(['Phone +359 888', '123 456 anytime.']),
    })
  })

  it('reads a split email, a marker across three sentences and a stop-cut address the same way', () => {
    expect(
      redactSentences(['Reach john@', 'example.com please.', 'Thanks.'], 'BG'),
    ).toMatchObject({
      status: 'redacted',
      sentences: ['Reach [CONTACT]', '[CONTACT] please.', 'Thanks.'],
    })
    expect(
      redactSentences(['Pay to BG80 BNBG 9661', '1020 3456 78 please.', 'Ok.'], 'BG'),
    ).toMatchObject({
      status: 'redacted',
      sentences: ['Pay to [FINANCIAL]', '[FINANCIAL] please.', 'Ok.'],
    })
  })

  it('says what the whole text says about every sentence it can be compared on', () => {
    const reviews = [
      ['Lovely room.', 'Write to owner@example.com for details.', 'Back soon.'],
      ['Call Maria.', '+359 888 123 456 thanks'],
      ['We were at 12 Oak Road.', 'Sofia 1000 was lovely.'],
      ['Mail me at a.b@', 'c.com ok'],
    ]
    for (const sentences of reviews) {
      const whole = redactWhole(sentences.join(' '), 'BG')
      const apart = redactSentences(sentences, 'BG')

      expect(whole.status).toBe('redacted')
      expect(apart.status).toBe('redacted')
      if (whole.status === 'redacted' && apart.status === 'redacted') {
        expect(reviewRedactionsAgree(whole.text, apart.sentences)).toBe(true)
      }
    }
  })
})
