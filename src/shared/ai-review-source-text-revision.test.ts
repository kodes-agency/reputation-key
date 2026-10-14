import { describe, expect, it } from 'vitest'
import {
  canonicalizeRawAiReviewSource,
  canonicalizeRawAiReviewSourcePreviousRevision,
  type RawAiReviewSource,
} from './ai-review-source-contract'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'
import { parseAiGatewayRouteRequest } from './ai-gateway-transport-contract'
import { analysisRequest } from './ai-gateway-transport-contract.test-fixtures'

function raw(
  text: string | null,
  reviewerDisplayName: string | null = null,
): RawAiReviewSource {
  return {
    text,
    rating: 4,
    languageCode: 'en',
    reviewedAtEpochMillis: 1,
    reviewerDisplayName,
  }
}

function textOf(text: string | null, reviewerDisplayName: string | null = null) {
  return canonicalizeRawAiReviewSource(raw(text, reviewerDisplayName)).text
}

describe('ai-source-v1 text revision 2: line breaks and tabs separate words', () => {
  it.each([
    [
      'LF',
      'Room was clean\nStaff were rude\n\nBreakfast was cold',
      'Room was clean Staff were rude Breakfast was cold',
    ],
    ['CRLF', 'Nice place\r\nWould return', 'Nice place Would return'],
    ['tabs', 'Pros:\tgreat view\tCons:\tnoisy', 'Pros: great view Cons: noisy'],
    ['vertical tab and form feed', 'one\u000btwo\u000cthree', 'one two three'],
    ['next line', 'one\u0085two', 'one two'],
    [
      'a break between sentences',
      'Great stay.\nStaff were kind.\nWould return.',
      'Great stay. Staff were kind. Would return.',
    ],
    ['a break hidden by a bidi mark', 'one\n‎\ntwo', 'one two'],
  ])('turns %s into one space', (_name, input, expected) => {
    expect(textOf(input)).toBe(expected)
  })

  it.each([
    ['a trailing break', 'Great stay\n', 'Great stay'],
    ['a leading break', '\r\nGreat stay', 'Great stay'],
    ['text made only of breaks', '\n\t\n', ''],
    ['a break after a space', 'word \nnext', 'word next'],
    ['a break before a space', 'word\n next', 'word next'],
  ])('adds no space for %s, as before', (_name, input, expected) => {
    expect(textOf(input)).toBe(expected)
  })

  it('still removes the other control and bidi characters without a space', () => {
    expect(textOf('a\u0000b‮c‏d⁦e\u007ff')).toBe('abcdef')
  })

  it('masks a reviewer name written across a line break', () => {
    expect(textOf('Jane Doe loved it', 'Jane\nDoe')).toBe('[PERSON] loved it')
  })

  it('keeps the previous revision available, deleting breaks as it did', () => {
    const previous = canonicalizeRawAiReviewSourcePreviousRevision(
      raw('Room was clean\nStaff were rude'),
    )
    expect(previous.text).toBe('Room was cleanStaff were rude')
  })

  it('changes the digest of text with an interior break and leaves other text alone', () => {
    const withBreak = raw('Room was clean\nStaff were rude')
    expect(canonicalizeRawAiReviewSource(withBreak).bytes).not.toEqual(
      canonicalizeRawAiReviewSourcePreviousRevision(withBreak).bytes,
    )
    const plain = raw('Room was clean. Staff were rude.\n')
    expect(canonicalizeRawAiReviewSource(plain).bytes).toEqual(
      canonicalizeRawAiReviewSourcePreviousRevision(plain).bytes,
    )
  })
})

describe('ai-source-v1 text revision 2: text the gateway can carry', () => {
  it('renormalizes after removing a mark that sat between a letter and its accent', () => {
    expect(textOf('cafe‎́ au lait')).toBe('café au lait')
  })

  it.each([
    ['U+FFFF', 'x￿y'],
    ['U+FFFE', 'x￾y'],
    ['U+FDD0', 'x﷐y'],
    ['U+FDEF', 'x﷯y'],
    ['U+1FFFF', 'x\u{1ffff}y'],
    ['U+10FFFE', 'x\u{10fffe}y'],
  ])('replaces the noncharacter %s with U+FFFD', (_name, input) => {
    expect(textOf(input)).toBe('x�y')
  })

  it('produces text the gateway request parser accepts', () => {
    const request = analysisRequest()
    const text = canonicalizeRawAiReviewSource(
      raw('Lovely stay\u{1ffff}, would return'),
    ).text
    const parsed = parseAiGatewayRouteRequest({
      ...request,
      source: { ...request.source, text },
    })
    expect(parsed.route).toBe('review-analysis')
  })
})

describe('ai-source-v1 text revision 2 with the redactor', () => {
  const SHORT_LINES =
    'Great stay.\nStaff were kind and the room was spotless.\nBreakfast could be better.\nWould return.'

  function redactedText(text: string) {
    const result = redactAiReviewText({
      text,
      countryCode: 'US',
      expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
      expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
      expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
      expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
    })
    return result.status === 'redacted' ? result.text : result.reason
  }

  it('lets a review written as short lines reach the model whole', () => {
    expect(redactedText(textOf(SHORT_LINES) ?? '')).toBe(
      'Great stay. Staff were kind and the room was spotless. Breakfast could be better. Would return.',
    )
  })

  it('is what the first revision got wrong: fused sentences read as domain names', () => {
    const fused =
      canonicalizeRawAiReviewSourcePreviousRevision(raw(SHORT_LINES)).text ?? ''
    expect(fused).toBe(
      'Great stay.Staff were kind and the room was spotless.Breakfast could be better.Would return.',
    )
    expect(redactedText(fused)).toContain('[CONTACT]')
  })
})
