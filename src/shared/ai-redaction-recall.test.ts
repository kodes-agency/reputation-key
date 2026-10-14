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

/**
 * A letter or a determiner in front of the house number. The first version took
 * every house number after `a`, `the`, `our`... for a count, and that includes
 * the letter A of a flat.
 */
const NUMBER_AFTER_A_WORD: readonly Shape[] = [
  ['Flat A', 'We booked Flat A 12 Oak Road for a week.', '12 Oak Road'],
  ['Unit A', 'We booked Unit A 5 Park Lane for a week.', '5 Park Lane'],
  ['Block A', 'We booked Block A 12 Oak Road for a week.', '12 Oak Road'],
  ['Entrance A', 'We booked Entrance A 5 Park Lane for a week.', '5 Park Lane'],
  ['Building A', 'We booked Building A 12 Oak Road for a week.', '12 Oak Road'],
  ['Studio A', 'We booked Studio A 5 Park Lane for a week.', '5 Park Lane'],
  ['Apt A', 'We booked Apt A 12 Oak Road for a week.', '12 Oak Road'],
  ['flat a in lower case', 'We booked flat a 12 Oak Road for a week.', '12 Oak Road'],
  ['our', 'We booked our 12 Oak Road for a week.', '12 Oak Road'],
  ['the', 'We booked the 5 Park Lane for a week.', '5 Park Lane'],
  ['his', 'We booked his 5 Park Lane for a week.', '5 Park Lane'],
  ['this', 'We booked this 12 Oak Road for a week.', '12 Oak Road'],
  ['every', 'We booked every 5 Park Lane for a week.', '5 Park Lane'],
  ['a', 'We booked a 5 Park Lane for a week.', '5 Park Lane'],
  ['your', 'We booked your 12 Oak Road for a week.', '12 Oak Road'],
]

describe('a house number after a letter or a determiner is still an address', () => {
  it.each(NUMBER_AFTER_A_WORD)('%s', (_name, text, address) => {
    expect(redacted(text)).toBe(replacing(text, address, '[ADDRESS]'))
  })

  it.each([
    'We stayed in a 5 Star Place with a pool.',
    'A 2 Bedroom Place With A Big Terrace And A Very Helpful Host.',
    'It was the 10 Minute Drive that made us tired.',
  ])('still reads a count after a determiner as a count: %s', (text) => {
    expect(redacted(text)).toBe(text)
  })
})

/**
 * A capitalised name is a street even when it is also a unit of measure or a
 * span of time: the first version ruled out `Miles`, `Weeks`, `Pounds`,
 * `Bucks`, `Times` and every place name with `on` or `in` inside it.
 */
const CAPITALISED_UNIT_STREETS: readonly Shape[] = [
  ['Miles', 'We stayed at 12 Miles Avenue last month.', '12 Miles Avenue'],
  ['Weeks', 'We stayed at 40 Weeks Street last month.', '40 Weeks Street'],
  ['Days', 'We stayed at 7 Days Road last month.', '7 Days Road'],
  ['Bucks Hill', 'We stayed at 3 Bucks Hill Road last month.', '3 Bucks Hill Road'],
  ['Pounds', 'We stayed at 9 Pounds Lane last month.', '9 Pounds Lane'],
  ['Old Weeks', 'We stayed at 221 Old Weeks Road last month.', '221 Old Weeks Road'],
  ['Weeks Mill', 'We stayed at 34 Weeks Mill Drive last month.', '34 Weeks Mill Drive'],
  ['Times', 'We stayed at 12 Times Court last month.', '12 Times Court'],
  ['Stars', 'We stayed at 221 Stars Drive last month.', '221 Stars Drive'],
  ['Steps', 'We stayed at 7 Steps Way last month.', '7 Steps Way'],
  ['Hours', 'We stayed at 12 Hours Street last month.', '12 Hours Street'],
  ['Years', 'We stayed at 7 Years Avenue last month.', '7 Years Avenue'],
  ['Cm', 'We stayed at 12 Cm Road last month.', '12 Cm Road'],
  ['Oak Weeks', 'We stayed at 12 Oak Weeks Street last month.', '12 Oak Weeks Street'],
  [
    'Oak Minutes',
    'We stayed at 12 Oak Minutes Street last month.',
    '12 Oak Minutes Street',
  ],
  [
    'Henley on Thames',
    'We stayed at 12 Henley on Thames Road last month.',
    '12 Henley on Thames Road',
  ],
  [
    'Walton on the Hill',
    'We stayed at 5 Walton on the Hill Road last month.',
    '5 Walton on the Hill Road',
  ],
  [
    'Sutton in Ashfield',
    'We stayed at 9 Sutton in Ashfield Road last month.',
    '9 Sutton in Ashfield Road',
  ],
  [
    'Stratford upon Avon',
    'We stayed at 4 Stratford upon Avon Way last month.',
    '4 Stratford upon Avon Way',
  ],
  [
    'Miles with no address lead',
    'It is 12 Miles Avenue, the red door.',
    '12 Miles Avenue',
  ],
]

describe('a capitalised street named like a unit or a span of time is replaced', () => {
  it.each(CAPITALISED_UNIT_STREETS)('%s', (_name, text, address) => {
    expect(redacted(text)).toBe(replacing(text, address, '[ADDRESS]'))
  })

  it.each([
    'Only 2 Minutes Drive from the beach.',
    'Stayed 5 Nights Near Main Street and walked everywhere.',
    'We stayed 3 Nights In A Lovely Place with a very friendly host.',
    'WE STAYED 5 NIGHTS NEAR MAIN STREET AND LOVED IT',
    'Booked 4 Weeks In Main Street Apartments, honestly lovely.',
  ])('still reads a title-case clause as a clause: %s', (text) => {
    expect(redacted(text)).toBe(text)
  })
})

/**
 * A name typed in lower case with an everyday word in it is a street after
 * `at` or a label: `We stayed at 12 love place`. Without such a word in front
 * of the number it is still read as the prose it usually is (`a 10 mile drive`).
 */
const EVERYDAY_WORD_STREETS_AFTER_AT: readonly Shape[] = [
  ['love place', 'We stayed at 221 love place last month.', '221 love place'],
  ['good place', 'We stayed at 12 good place last month.', '12 good place'],
  [
    'mile end drive',
    'We stayed at 1400 mile end drive last month.',
    '1400 mile end drive',
  ],
  [
    'mile end place',
    'We stayed at 1400 mile end place last month.',
    '1400 mile end place',
  ],
  ['star drive', 'We stayed at 221 star drive last month.', '221 star drive'],
  ['mile drive', 'We stayed at 12 mile drive last month.', '12 mile drive'],
  [
    'all saints road',
    'We stayed at 12 all saints road last month.',
    '12 all saints road',
  ],
  [
    'all saints street',
    'We stayed at 12 all saints street last month.',
    '12 all saints street',
  ],
  ['lane cove road', 'We stayed at 12 lane cove road last month.', '12 lane cove road'],
  [
    'under hill road',
    'We stayed at 12 under hill road last month.',
    '12 under hill road',
  ],
  ['dirty place', 'We stayed at 34 dirty place last month.', '34 dirty place'],
  [
    'seven stars road',
    'We stayed at 221 seven stars road last month.',
    '221 seven stars road',
  ],
  ['six mile place', 'We stayed at 19 six mile place last month.', '19 six mile place'],
  ['way street', 'We stayed at 12 way street last month.', '12 way street'],
  ['every street', 'We stayed at 12 every street last month.', '12 every street'],
  ['only road', 'We stayed at 12 only road last month.', '12 only road'],
  ['the drive', 'We stayed at 1400 the drive last month.', '1400 the drive'],
  ['the way', 'We stayed at 7 the way last month.', '7 the way'],
  ['bedrooms road', 'We stayed at 12 bedrooms road last month.', '12 bedrooms road'],
  ['stars road', 'We stayed at 12 stars road last month.', '12 stars road'],
  [
    'an address label',
    'The hotel address is 19 six mile place. Very friendly staff.',
    '19 six mile place',
  ],
  ['an address label and a colon', 'Address: 12 star drive, then left.', '12 star drive'],
]

describe('a lower-case street with an everyday word is replaced after at or a label', () => {
  it.each(EVERYDAY_WORD_STREETS_AFTER_AT)('%s', (_name, text, address) => {
    expect(redacted(text)).toBe(replacing(text, address, '[ADDRESS]'))
  })

  it.each([
    'We arrived at 10 in the morning and loved the place.',
    'Dinner at 8 was a lovely way to end the day.',
    'It was open from 9 am all the way to midnight.',
    'Taxi to 12 mile drive area cost 20 euros.',
    'We stayed at 3 star places all week and the road trips were fun.',
    'Check out at 12 noon at the latest, the court yard is lovely.',
    'We stayed at 12 Oak Road also a nice place!',
  ])('keeps the prose around at: %s', (text) => {
    const out = redacted(text)
    expect(out).toBe(text.replace('12 Oak Road', '[ADDRESS]'))
  })
})
