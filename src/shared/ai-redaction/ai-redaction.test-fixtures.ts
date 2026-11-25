import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import { canonicalizeRawAiReviewSource } from '../ai-review-source/ai-review-source-contract'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'

export function redact(text: string, countryCode = 'US') {
  return redactAiReviewText({
    text,
    countryCode,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
}

export function redacted(text: string, countryCode = 'US'): string {
  const result = redact(text, countryCode)
  if (result.status !== 'redacted') {
    throw new Error(`expected a redacted result, got ${result.status}:${result.reason}`)
  }
  return result.text
}

/** The pipeline as it runs: the raw text of the review, its canonical source text, the redactor. */
export function redactedRaw(raw: string, countryCode = 'US'): string {
  const canonical = canonicalizeRawAiReviewSource({
    text: raw,
    rating: 5,
    languageCode: 'en',
    reviewedAtEpochMillis: 1_700_000_000_000,
    reviewerDisplayName: null,
  }).text
  if (canonical === null) throw new Error('the canonicalizer returned no text')
  return redacted(canonical, countryCode)
}

/** The text with `personal` replaced by `placeholder` and nothing else changed. */
export function replacing(text: string, personal: string, placeholder: string): string {
  return text.replace(personal, placeholder)
}

/** A review long enough that one replaced address never trips the ratio rule. */
export function inShortReview(clause: string): string {
  return `The room was quiet, the breakfast was fresh and the staff were kind. ${clause} We would gladly come back with our friends next summer.`
}

/** Splits a comma-separated list; names that hold spaces stay whole. */
export function words(list: string): readonly string[] {
  return list.split(',').map((word) => word.trim())
}

export type Shape = readonly [name: string, text: string, personal: string]

/** A review long enough that main refused it whenever it held a digit and a street word. */
const LONG_REVIEW_LEAD =
  'We stayed for 3 nights in July with our two kids and everything went smoothly. The room was clean, the breakfast was fresh and varied, the staff were very helpful with the luggage, and the pool was warm every afternoon. We would happily come back next year.'

function inLongReview(clause: string): string {
  return `${LONG_REVIEW_LEAD} ${clause}`
}

export const REVIEW_FRAMES: ReadonlyArray<readonly [string, (clause: string) => string]> =
  [
    ['a short review', inShortReview],
    ['a long review', inLongReview],
  ]

/** Each row of `table` is replaced by `placeholder`, once in a short and once in a long review. */
export function describeInFrames(
  title: string,
  table: readonly Shape[],
  placeholder: string,
  countryCode = 'US',
): void {
  describe.each(REVIEW_FRAMES)(title, (_frame, wrap) => {
    it.each(table)('%s', (_name, clause, personal) => {
      const text = wrap(clause)
      expect(redacted(text, countryCode)).toBe(replacing(text, personal, placeholder))
    })
  })
}
