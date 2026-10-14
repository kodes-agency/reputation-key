// Personal data that main removed and the first version of the ordinary-prose
// fix let through: each shape here was found by the independent privacy check
// of 2026-10-14 (round 1) and fails against that version. The prose the same
// rules protect is pinned in `ai-redaction-ordinary-prose.test.ts`.

import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'

function redacted(text: string, countryCode = 'US'): string {
  const result = redactAiReviewText({
    text,
    countryCode,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (result.status !== 'redacted') {
    throw new Error(`expected a redacted result, got ${result.status}:${result.reason}`)
  }
  return result.text
}

/** The text with `personal` replaced by `placeholder` and nothing else changed. */
function replacing(text: string, personal: string, placeholder: string): string {
  return text.replace(personal, placeholder)
}

type Shape = readonly [name: string, text: string, personal: string]

/**
 * A real address followed, within eight words, by another street-type word
 * (`place`, `way`, `court`, `drive`, `dr`, `st`...). The first version read the
 * longest run of words that ends in a street-type word, took it for a clause
 * of the review and never tried the shorter run that is the address.
 */
const ADDRESS_THEN_STREET_WORD: readonly Shape[] = [
  [
    'a sentence about a great place',
    'We stayed at 12 Oak Road. It was a great place.',
    '12 Oak Road',
  ],
  [
    'a clause about a place to be',
    'We stayed at 12 Oak Road and it was a great place to be.',
    '12 Oak Road',
  ],
  [
    'a clause with a season and the place',
    'We stayed at 12 Oak Road last summer and loved the place.',
    '12 Oak Road',
  ],
  [
    'a clause about the road to the beach',
    'Our hotel is at 12 Oak Road and the road to the beach is short.',
    '12 Oak Road',
  ],
  [
    'a title and a name after the address',
    'Our hotel is at 12 Oak Road. Dr. Petrov helped a lot',
    '12 Oak Road',
  ],
  [
    'a saint after the address',
    'Our hotel is at 8 Maple Drive. St. Anne helped a lot',
    '8 Maple Drive',
  ],
  [
    'a court after the address',
    'Our hotel is at 5 Park Lane. Their court was great',
    '5 Park Lane',
  ],
  [
    'praise without a comma',
    'Our hotel is at 12 Oak Road also a nice place!',
    '12 Oak Road',
  ],
  [
    'a hotel name before the address',
    'Hotel Sunrise, 12 Oak Road. It was a great place.',
    '12 Oak Road',
  ],
  [
    'a room before the address',
    'Room 304 at 12 Oak Road. It was a great place.',
    '12 Oak Road',
  ],
  [
    'a city on the next line',
    'Our hotel is at 12 Oak Road\nSofia\nWe loved the way they greeted us',
    '12 Oak Road',
  ],
  [
    'a drive after a way',
    'We stayed at 42 Wallaby Way. Parking on the drive was free.',
    '42 Wallaby Way',
  ],
  [
    'a lower-case abbreviation and a place',
    'The hotel is at 7 elm st. We would recommend this place to anyone.',
    '7 elm st',
  ],
  [
    'a boulevard and a drive',
    'The hotel is at 19 Sunset Boulevard. Parking on the drive was free.',
    '19 Sunset Boulevard',
  ],
  [
    'an address ending a long review',
    'We stayed for 3 nights in July with our two kids and everything went smoothly. The room was clean, the breakfast was fresh and varied, the staff were very helpful with the luggage, and the pool was warm every afternoon. We would happily come back next year. Our taxi left us at 12 Oak Road. It was a lovely place.',
    '12 Oak Road',
  ],
]

describe('an address followed by another street-type word is still replaced', () => {
  it.each(ADDRESS_THEN_STREET_WORD)('%s', (_name, text, address) => {
    expect(redacted(text)).toBe(replacing(text, address, '[ADDRESS]'))
  })

  it('replaces a spelled-out house number followed by a sentence about a place', () => {
    const text = 'Twelve Oak Road. It was a great place'
    expect(redacted(text)).toBe('[ADDRESS]. It was a great place')
  })
})
