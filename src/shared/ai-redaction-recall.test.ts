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
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
import { BASE_STREET_TYPE_WORDS, EXTRA_STREET_TYPE_WORDS } from './ai-address-words'
import { canonicalizeRawAiReviewSource } from './ai-review-source-contract'
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

/** The pipeline as it runs: the raw text of the review, its canonical source text, the redactor. */
function redactedRaw(raw: string, countryCode = 'US'): string {
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

/** A review long enough that main refused it whenever it held a digit and a street word. */
const LONG_REVIEW_LEAD =
  'We stayed for 3 nights in July with our two kids and everything went smoothly. The room was clean, the breakfast was fresh and varied, the staff were very helpful with the luggage, and the pool was warm every afternoon. We would happily come back next year.'

function inShortReview(clause: string): string {
  return `The room was quiet, the breakfast was fresh and the staff were kind. ${clause} We would gladly come back with our friends next summer.`
}

function inLongReview(clause: string): string {
  return `${LONG_REVIEW_LEAD} ${clause}`
}

const REVIEW_FRAMES: ReadonlyArray<readonly [string, (clause: string) => string]> = [
  ['a short review', inShortReview],
  ['a long review', inLongReview],
]

/**
 * Main refused every review over 256 characters that held a digit and one of
 * thirteen street words, so each of these layouts was withheld from the provider
 * in a long review by accident and, in a short one, was never read. Each is read
 * on purpose now.
 */
const NUMBER_LAST_LAYOUTS: readonly Shape[] = [
  ['a flat after a slash', 'Meet us at (Oak Road 12/3) please.', 'Oak Road 12/3'],
  [
    'a number in brackets with a label',
    'Address: Oak Road (no. 12).',
    'Oak Road (no. 12)',
  ],
  [
    'house and a number',
    'Address: Oak Road, house 12 Sofia 1000',
    'Oak Road, house 12 Sofia 1000',
  ],
  ['a number with a label and a colon', 'Street: Oak Road, No: 12', 'Oak Road, No: 12'],
  [
    'a number written out ending a list item',
    '- Oak Street twelve - free parking',
    'Oak Street twelve',
  ],
  ['house nr.', 'Address: Oak Road house nr. 12.', 'Oak Road house nr. 12'],
  [
    'a lower-case street and a number',
    'Address: oak road 12 Sofia 1000',
    'oak road 12 Sofia 1000',
  ],
  ['N°', '- Oak Road N° 12 - free parking', 'Oak Road N° 12'],
  ['an ordinal house', 'Address: Oak Road, 12th house.', 'Oak Road, 12th house'],
  [
    'a lower-case street in a sentence',
    'We met at main street 25 near the station.',
    'main street 25',
  ],
  ['a lower-case abbreviation', 'We stayed on oak rd 12 for a week.', 'oak rd 12'],
  [
    'a determiner in front of the name',
    'The Beach Road 12 was busy near the sea.',
    'Beach Road 12',
  ],
]

describe.each(REVIEW_FRAMES)('a number-last layout is replaced in %s', (_frame, wrap) => {
  it.each(NUMBER_LAST_LAYOUTS)('%s', (_name, clause, personal) => {
    const text = wrap(clause)
    expect(redacted(text)).toBe(replacing(text, personal, '[ADDRESS]'))
  })
})

/** Street types beyond the thirteen, written the way a proper name is. */
const OTHER_ENGLISH_TYPES: readonly Shape[] = [
  ['Close', 'The flat at 12 Oak Close was cosy.', '12 Oak Close'],
  ['Crescent', 'Our host lives at 5 Rose Crescent in the old town.', '5 Rose Crescent'],
  ['Gardens', 'We stayed at 7 Elm Gardens last month.', '7 Elm Gardens'],
  ['Square', 'We stayed at 14 Victoria Square last month.', '14 Victoria Square'],
  ['Parkway', 'We stayed at 55 Ocean Parkway last month.', '55 Ocean Parkway'],
  ['Terrace', 'We stayed at 742 Evergreen Terrace last month.', '742 Evergreen Terrace'],
  ['Grove', 'We stayed at 18 Willow Grove last month.', '18 Willow Grove'],
  ['Circle', 'We stayed at 9 Cedar Circle last month.', '9 Cedar Circle'],
  ['Walk', 'We stayed at 61 Hawthorn Walk last month.', '61 Hawthorn Walk'],
  ['Trail', 'We stayed at 100 Lakeview Trail last month.', '100 Lakeview Trail'],
  ['Loop', 'We stayed at 1 Infinite Loop last month.', '1 Infinite Loop'],
  ['Hwy', 'We stayed at 88 Harbour Hwy last month.', '88 Harbour Hwy'],
  ['Mews', 'We stayed at 20 Rose Mews last month.', '20 Rose Mews'],
  ['Approach', 'We stayed at 6 Station Approach last month.', '6 Station Approach'],
  ['Alley', 'We stayed at 3 Pine Alley last month.', '3 Pine Alley'],
  ['Plaza', 'We stayed at 4 Palm Plaza last month.', '4 Palm Plaza'],
  ['Pkwy', 'We stayed at 9 Cedar Pkwy last month.', '9 Cedar Pkwy'],
  ['Row', 'We stayed at 2 Abbey Row last month.', '2 Abbey Row'],
  ['a type that is its own street', 'The shop at 50 Broadway was fine.', '50 Broadway'],
  ['Close, number last', 'We found Oak Close 12 easily.', 'Oak Close 12'],
]

describe.each(REVIEW_FRAMES)(
  'an English street type beyond thirteen in %s',
  (_frame, wrap) => {
    it.each(OTHER_ENGLISH_TYPES)('%s', (_name, clause, personal) => {
      const text = wrap(clause)
      expect(redacted(text)).toBe(replacing(text, personal, '[ADDRESS]'))
    })
  },
)

describe('the street types that are everyday words stay prose in lower case', () => {
  it.each([
    'We had 3 close friends with us all week.',
    'There was a nice walk to the beach, 2 walk paths in the park.',
    'It is a 10 minute walk from the station.',
    'We booked 2 rooms on the square and 4 rows of loungers by the pool.',
    'Top 10 Best Terrace Restaurants in Sofia, honestly.',
  ])('%s', (text) => {
    expect(redacted(text)).toBe(text)
  })
})

/** Streets of other languages, with the type before the name or at its end. */
const FOREIGN_STREETS: readonly Shape[] = [
  ['rue', 'It was at 12 rue de la Paix near the river.', '12 rue de la Paix'],
  [
    'rue in lower case with a lower-case name',
    'We stayed at 16 rue de rivoli last week.',
    '16 rue de rivoli',
  ],
  [
    'Rue with a capital',
    'We stayed at 5 Rue Victor Hugo last week.',
    '5 Rue Victor Hugo',
  ],
  ['calle', 'Calle Mayor 5 was easy to find.', 'Calle Mayor 5'],
  [
    'calle with the number first',
    'We stayed at 5 Calle Mayor last week.',
    '5 Calle Mayor',
  ],
  ['via', 'We stayed at Via Roma 10 for a week.', 'Via Roma 10'],
  [
    'rua with a particle',
    'We stayed at Rua das Flores 23 for a week.',
    'Rua das Flores 23',
  ],
  ['strada', 'We stayed at Strada Victoriei 12 for a week.', 'Strada Victoriei 12'],
  ['Straße', 'We found Hauptstraße 12 easily.', 'Hauptstraße 12'],
  ['strasse', 'We found Pestalozzistrasse 3 easily.', 'Pestalozzistrasse 3'],
  ['straat', 'We found Hoofdstraat 12 easily.', 'Hoofdstraat 12'],
  ['gatan', 'We found Kungsgatan 12 easily.', 'Kungsgatan 12'],
  ['gata', 'We found Storgata 12 easily.', 'Storgata 12'],
  ['gade', 'We found Nørregade 12 easily.', 'Nørregade 12'],
  ['Caddesi', 'We found Atatürk Caddesi No: 5 easily.', 'Atatürk Caddesi No: 5'],
  ['ut', 'We found Andrassy ut 12 easily.', 'Andrassy ut 12'],
]

describe.each(REVIEW_FRAMES)('a street of another language in %s', (_frame, wrap) => {
  it.each(FOREIGN_STREETS)('%s', (_name, clause, personal) => {
    const text = wrap(clause)
    expect(redacted(text)).toBe(replacing(text, personal, '[ADDRESS]'))
  })
})

/** The address after a label, whatever the language of its street. */
const LABELLED_ADDRESSES: readonly Shape[] = [
  ['no type word', 'Address: Karlova 12.', 'Karlova 12'],
  ['a Greek street', 'Address: Vasilissis Sofias 12.', 'Vasilissis Sofias 12'],
  [
    'a postcode and a city',
    'Address: Karlova 12, 110 00 Praha 1.',
    'Karlova 12, 110 00 Praha 1',
  ],
  ['a label with a different spelling', 'Adresse: Karlova 12 Praha.', 'Karlova 12 Praha'],
  ['a Bulgarian label', 'Адрес: Витоша 25 София.', 'Витоша 25 София'],
]

describe.each(REVIEW_FRAMES)('the address after a label in %s', (_frame, wrap) => {
  it.each(LABELLED_ADDRESSES)('%s', (_name, clause, personal) => {
    const text = wrap(clause)
    expect(redacted(text)).toBe(replacing(text, personal, '[ADDRESS]'))
  })

  it.each([
    'Address: easy to find, 5 min from the beach.',
    'Address: perfect location! Rooms: clean.',
    'The address was in the booking confirmation and check-in was at 3 pm.',
    'Address: Sofia.',
  ])('leaves a label with prose after it alone: %s', (clause) => {
    const text = wrap(clause)
    expect(redacted(text)).toBe(text)
  })
})

/**
 * Prose that the layouts added for recall (the number last, a number written
 * out, the street word first, Bulgarian street words) took for an address in the
 * first version of this repair. Main left every one alone.
 */
const PROSE_THE_NEW_LAYOUTS_LEAVE_ALONE: ReadonlyArray<readonly [string, string]> = [
  ['praise and a rating out of ten', 'Great Place 10 out of 10'],
  ['praise in lower case and a rating', 'Great place 10 out of 10'],
  ['praise, a rating and more praise', 'Awesome Place 10 and a great pool'],
  ['best way and a digit for to', 'Best Way 2 travel is by train'],
  ['best way and a rank', 'Best Way 1 to go.'],
  ['best place for families', 'Best place 4 families.'],
  ['top place and a rank', 'Top place 1 in town.'],
  ['a quiet street at three a.m.', 'Quiet street 3 am at night'],
  ['a road and stops', 'Take Station Road 2 stops from here.'],
  ['a street and hours', 'Main Street 24h parking is free.'],
  ['a hotel, a drive and a digit for to', 'Hotel Drive 2 beach was easy.'],
  ['rated great place', 'Rated Great Place 9 by guests'],
  ['nice way to relax', 'Nice way 2 relax'],
  ['excellent place and a score', 'Excellent Place 10'],
  ['wonderful place and a score', 'Wonderful Place 9 and cheap.'],
  ['great street and a rating', 'Great Street 8 rating.'],
  ['a number written out and a star place', 'Five Star Place to stay, honestly.'],
  ['a number written out and a bedroom place', 'Two Bedroom Place with a view.'],
  ['a number written out and a day drive', 'Three Day Drive from the capital was fine.'],
  [
    'a number written out and a one way street',
    'One Way Street signs everywhere in the old town.',
  ],
  ['a number written out and a star court', 'Four Star Court Hotel was lovely.'],
  [
    'a number written out and a day drive along the coast',
    'Seven Day Drive along the coast.',
  ],
  ['a number written out and a lane road', 'Twenty Lane Road to the beach.'],
  ['a number written out and a two way street', 'Two Way Street for sure, they listen.'],
  ['a number written out and a day place', 'One Day Place Visit worth it.'],
  ['a number written out and a mile drive', 'Nine Mile Drive was fun.'],
  ['a street word first and a hotel', 'Avenue Hotel 5 was lovely.'],
  ['a street word first and a song', 'Ave Maria 2 and another song.'],
  ['a street word first and mats', 'Place Mats 4 pieces.'],
  ['a street word first and a plaza', 'Boulevard Plaza 3 was great.'],
  ['a street word first and settings', 'Place Settings 12 were nice.'],
  ['a Bulgarian street word and free', 'ул. Красива маса 2 безплатни'],
  ['a Bulgarian street word and a rating', 'бул. работа 10 от 10'],
  ['a Bulgarian square word and coffee', 'пл. Кофе 3 без захар'],
  [
    'an at sign, a blank and a word',
    'Insta @ the pool was great and @ 5pm the bar opens',
  ],
]

describe('the layouts added for recall leave this prose alone', () => {
  it.each(PROSE_THE_NEW_LAYOUTS_LEAVE_ALONE)('%s', (_name, text) => {
    expect(redacted(inShortReview(text), 'BG')).toBe(inShortReview(text))
  })
})

/**
 * Coordinate pairs that main removed only because its bare-domain rule took each
 * decimal for a domain. The first version of this repair read a pair in a comma,
 * a semicolon or a blank and nothing else.
 */
const COORDINATE_FORMS: readonly Shape[] = [
  ['a slash', 'GPS 42.6977/23.3219.', '42.6977/23.3219'],
  ['a spaced slash', 'GPS 42.6977 / 23.3219.', '42.6977 / 23.3219'],
  ['a bar', 'The pin is 42.6977|23.3219 and it was worth the walk.', '42.6977|23.3219'],
  [
    'an x',
    'The hidden cove pin is 42.6977 x 23.3219 and it was worth the walk.',
    '42.6977 x 23.3219',
  ],
  ['a hyphen', 'The pin is 42.6977 - 23.3219 near the cove.', '42.6977 - 23.3219'],
  ['lat and lon in a query', 'GPS lat=42.6977&lon=23.3219.', 'lat=42.6977&lon=23.3219'],
  ['lat and lng in a query', 'GPS lat=42.6977&lng=23.3219.', 'lat=42.6977&lng=23.3219'],
  [
    'lat and long with and',
    'The pin is lat 42.6977 and long 23.3219 near the cove.',
    'lat 42.6977 and long 23.3219',
  ],
  [
    'lat and lon with a comma and and',
    'The pin is lat 42.6977, and lon 23.3219 near the cove.',
    'lat 42.6977, and lon 23.3219',
  ],
  ['Lat. and Long.', 'GPS Lat. 42.6977 Long. 23.3219.', 'Lat. 42.6977 Long. 23.3219'],
  [
    'labels in brackets',
    'The pin is 42.6977 (lat) 23.3219 (lon) near the cove.',
    '42.6977 (lat) 23.3219 (lon)',
  ],
  [
    'coords and then',
    'Pin: coords 42.6977, then 23.3219 near the cove.',
    '42.6977, then 23.3219',
  ],
  [
    'hemispheres with a slash',
    'Pin: 42.6977°N/23.3219°E near the cove.',
    '42.6977°N/23.3219°E',
  ],
  ['ISO 6709', 'GPS +42.6977+023.3219/ near the cove.', '+42.6977+023.3219/'],
  [
    'degrees, minutes and decimal seconds',
    'Pin: 42°41\'52.7"N 23°19\'19.2"E near the cove.',
    '42°41\'52.7"N 23°19\'19.2"E',
  ],
  [
    'spaced degrees, minutes and seconds',
    'The pin is 42° 41\' 52.7" N, 23° 19\' 19.2" E near the cove.',
    '42° 41\' 52.7" N, 23° 19\' 19.2" E',
  ],
  [
    'degrees and decimal minutes',
    "GPS N 42° 41.862' E 23° 19.320' near the cove.",
    "N 42° 41.862' E 23° 19.320'",
  ],
  [
    'degrees and decimal minutes, hemispheres after',
    "Pin: 42°41.862'N 23°19.320'E near the cove.",
    "42°41.862'N 23°19.320'E",
  ],
  ['NMEA', 'The pin is 4269.77N 2319.32E near the cove.', '4269.77N 2319.32E'],
  [
    'two decimals after pin',
    'The hidden cove pin is 42.69, 23.32 and it was worth the walk.',
    '42.69, 23.32',
  ],
  ['one decimal after GPS', 'GPS 42.6, 23.3 near the cove.', '42.6, 23.3'],
]

describe('a coordinate pair is replaced in any layout a guest types', () => {
  it.each(COORDINATE_FORMS)('%s', (_name, text, pair) => {
    const wrapped = inShortReview(text)
    expect(redacted(wrapped)).toBe(replacing(wrapped, pair, '[ADDRESS]'))
  })

  it.each([
    ['scores', 'Scores: 8.5, 9.0, 7.5 and 8.0 on four sites.'],
    ['prices', 'Prices were 12.50, 14.75 and 9.99 for the three menus.'],
    ['bed sizes', 'Beds were 1.60 x 2.00 and the room 25.5 m2.'],
    ['a weight', 'Gewicht 1,2345 2,3456 kg.'],
    ['an exchange rate', 'Kurs 1,0850 1,0920 stieg.'],
    ['an exchange rate with a semicolon', 'Rate 1,0850; 1,0920 today.'],
    ['thousands', 'We paid 10,000 and then 12,500 for the room.'],
    [
      'a version and a time',
      'The kiosk ran 2.4.5 and check-in was 14.30, 15.00 at most.',
    ],
  ])('leaves %s alone', (_name, text) => {
    const wrapped = inShortReview(text)
    expect(redacted(wrapped)).toBe(wrapped)
  })
})

/** IP addresses main removed through the bare-domain rule or by accident. */
const IP_FORMS: readonly Shape[] = [
  [
    'a port and a full stop',
    'Their server is 203.0.113.9:8080. and it was down.',
    '203.0.113.9:8080',
  ],
  ['a port and a colon', 'Their server: 203.0.113.9:8080: was down.', '203.0.113.9:8080'],
  ['brackets', 'Their server is [203.0.113.9] and it was down.', '[203.0.113.9]'],
  ['brackets and a full stop', 'Their server: [203.0.113.9]. was down.', '[203.0.113.9]'],
  [
    'brackets and a comma',
    'Their server: [203.0.113.9], thanks was down.',
    '[203.0.113.9]',
  ],
  [
    'brackets and a port',
    'Their server is [203.0.113.9]:8080 and it was down.',
    '[203.0.113.9]:8080',
  ],
  ['zero-padded', 'Their server is 192.168.001.001 and it was down.', '192.168.001.001'],
  [
    'zero-padded, all groups',
    'Their server: 010.000.000.001 was down.',
    '010.000.000.001',
  ],
  [
    'an IPv4 address and a port in brackets',
    'Their server is [192.0.2.55:8080] and it was down.',
    '[192.0.2.55:8080]',
  ],
  [
    'brackets and an ellipsis',
    'Their server: [203.0.113.9]... was down.',
    '[203.0.113.9]',
  ],
  [
    'hexadecimal',
    'Their server is 0xC0.0xA8.0x01.0x01 and it was down.',
    '0xC0.0xA8.0x01.0x01',
  ],
  [
    'an IPv6 address with a port and a full stop',
    'Server: [2001:db8::1]:443. It was down.',
    '[2001:db8::1]:443',
  ],
]

describe.each(REVIEW_FRAMES)('an IP address in a rarer layout in %s', (_frame, wrap) => {
  it.each(IP_FORMS)('%s', (_name, clause, address) => {
    const text = wrap(clause)
    expect(redacted(text)).toBe(replacing(text, address, '[CONTACT]'))
  })
})

describe('an address-like number that is not an IP address stays', () => {
  it.each([
    'Room 300.400.500.600 had a view and the key 1.2.3 worked.',
    'We rated 4.5.6 on one site and 1.2.3.4.5 on another version.',
  ])('%s', (text) => {
    const wrapped = inShortReview(text)
    expect(redacted(wrapped)).toBe(wrapped)
  })
})

/**
 * Revision 2 of the source text turns a line break into a blank, so a token a
 * break split reaches the redactor as two pieces. Main joined them and removed
 * the whole; the first version of this repair removed only the piece that still
 * looked like a contact. Each case is the raw text of a review: what must not
 * survive, and the placeholder that must stand in its place.
 */
const SPLIT_BY_A_LINE_BREAK: ReadonlyArray<
  readonly [name: string, raw: string, gone: readonly string[], placeholder: string]
> = [
  [
    'a domain split inside its name',
    'See hotelsun\nrise.com for the rooms.',
    ['hotelsun', 'rise.com'],
    '[CONTACT]',
  ],
  [
    'a domain split inside its name, with a path',
    'See hotelsun\nrise.bg/rooms now.',
    ['hotelsun', 'rise.bg'],
    '[CONTACT]',
  ],
  [
    'a domain split at a hyphen',
    'Our site is sunrise-ho\ntel.bg for the rooms.',
    ['sunrise-ho', 'tel.bg'],
    '[CONTACT]',
  ],
  [
    'a domain split after its dot',
    'Our site is hotelsunrise.\ncom for the rooms.',
    ['hotelsunrise', 'com for'],
    '[CONTACT]',
  ],
  [
    'a domain split after its dot, bg',
    'Our site is hotelsunrise.\nbg for the rooms.',
    ['hotelsunrise', 'bg for'],
    '[CONTACT]',
  ],
  [
    'a domain split before its dot, it',
    'Our site is hotelsunrise\n.it for the rooms.',
    ['hotelsunrise'],
    '[CONTACT]',
  ],
  [
    'a domain split before its dot, es',
    'Our site is hotelsunrise\n.es for the rooms.',
    ['hotelsunrise'],
    '[CONTACT]',
  ],
  [
    'a domain split before its dot, upper case',
    'Our site is hotelsunrise\n.COM for the rooms.',
    ['hotelsunrise'],
    '[CONTACT]',
  ],
  [
    'a domain in camel case split before its dot',
    'Our site is HotelSunrise\n.com for the rooms.',
    ['HotelSunrise'],
    '[CONTACT]',
  ],
  [
    'an email split after a dot',
    'Write to john.\nsmith@gmail.com please.',
    ['john.', 'smith@gmail'],
    '[CONTACT]',
  ],
  [
    'an email split before a dot',
    'Write to john\n.smith@gmail.com please.',
    ['john', 'smith@gmail'],
    '[CONTACT]',
  ],
  [
    'an email split in its domain',
    'Write to john.smith@gma\nil.com please.',
    ['john.smith', 'gma', 'il.com'],
    '[CONTACT]',
  ],
  [
    'a handle split after the at sign',
    'Insta @\njohn_smith please.',
    ['john_smith'],
    '[CONTACT]',
  ],
  [
    'a handle split after an underscore',
    'Insta @john_\nsmith please.',
    ['john_', 'smith'],
    '[CONTACT]',
  ],
  [
    'an IP address split after a dot',
    'Router 192.168.\n1.1 is slow.',
    ['192.168', '1.1'],
    '[CONTACT]',
  ],
  [
    'an IP address split before a dot',
    'Router 192.168.1\n.1 is slow.',
    ['192.168.1'],
    '[CONTACT]',
  ],
  [
    'an IP address split inside a group',
    'Router 192.16\n8.1.1 is slow.',
    ['192.16', '8.1.1'],
    '[CONTACT]',
  ],
  [
    'an IP address split before its last group',
    'Router 203.0.113.\n9 is slow.',
    ['203.0.113', ' 9'],
    '[CONTACT]',
  ],
  [
    'a phone number split after its plus',
    'Call +\n359888123456 now.',
    ['359888123456'],
    '[CONTACT]',
  ],
  [
    'a passport number split in two',
    'My passport AB12\n34567 was checked.',
    ['AB12', '34567'],
    '[IDENTIFIER]',
  ],
  [
    'a street type split in two',
    'We stayed at 12 Oak Ro\nad and loved it.',
    ['12 Oak', 'Ro', 'ad and'],
    '[ADDRESS]',
  ],
  [
    'a street type split in two, with a postal tail',
    'Visit 12 Oak Ro\nad Sofia 1000 and then go on.',
    ['12 Oak', 'Sofia 1000'],
    '[ADDRESS]',
  ],
  [
    'a street name split in two',
    'We stayed at 12 Ma\nin Street and loved it.',
    ['12 Ma', 'in Street'],
    '[ADDRESS]',
  ],
  [
    'a coordinate split inside its fraction',
    'The hidden cove pin 42.69\n77, 23.3219 here.',
    ['42.69', '77', '23.3219'],
    '[ADDRESS]',
  ],
  [
    'an email split after an underscore',
    'Write to maria_\nivanova@abv.bg please.',
    ['maria_', 'ivanova'],
    '[CONTACT]',
  ],
  [
    'an email split before an underscore',
    'Write to maria\n_ivanova@abv.bg please.',
    ['maria', 'ivanova'],
    '[CONTACT]',
  ],
  [
    'a host split after a dot, three labels',
    'Great stay, kind staff and a clean room. Our site is menu.\nrestaurant-roma.co.uk now.',
    ['menu', 'restaurant-roma'],
    '[CONTACT]',
  ],
  [
    'a host split before a dot, three labels',
    'Great stay, kind staff and a clean room. Our site is menu\n.restaurant-roma.co.uk now.',
    ['menu', 'restaurant-roma'],
    '[CONTACT]',
  ],
  [
    'a host split inside its last name',
    'Great stay, kind staff and a clean room. Our site is menu.restaurant-ro\nma.co.uk now.',
    ['menu', 'restaurant-ro', 'ma.co'],
    '[CONTACT]',
  ],
  [
    'a top-level domain split in two',
    'Our site is hotelsunrise.c\nom for the rooms.',
    ['hotelsunrise', 'c om'],
    '[CONTACT]',
  ],
  [
    'a country top-level domain split in two',
    'Great stay, kind staff and a clean room. Our site is menu.restaurant-roma.co.u\nk now.',
    ['restaurant-roma', 'u k'],
    '[CONTACT]',
  ],
  [
    'a URL split after its host start',
    'See https://h\notelsunrise.com/rooms for details.',
    ['hotelsunrise', 'https://h '],
    '[CONTACT]',
  ],
  [
    'a short handle split',
    'Insta @j\nohn_smith please.',
    ['john_smith', 'ohn_smith'],
    '[CONTACT]',
  ],
  [
    'an at sign and a blank before a handle',
    'See @\njohn_smith for details.',
    ['john_smith'],
    '[CONTACT]',
  ],
  [
    'a coordinate split before the point',
    'The hidden cove pin 42\n.6977, 23.3219 here.',
    ['42', '6977', '23.3219'],
    '[ADDRESS]',
  ],
  [
    'a coordinate split after the point of the second number',
    'The hidden cove pin N 42.6977 E 23.\n3219 here.',
    ['42.6977', '3219'],
    '[ADDRESS]',
  ],
  [
    'a coordinate split inside the second number',
    'The hidden cove pin 42.6977, 2\n3.3219 here.',
    ['42.6977', '3.3219'],
    '[ADDRESS]',
  ],
  [
    'a passport number split after two letters',
    'My passport AB\n1234567 was checked.',
    ['1234567'],
    '[IDENTIFIER]',
  ],
  [
    'a passport number split after the third character',
    'My passport AB1\n234567 was checked.',
    ['234567'],
    '[IDENTIFIER]',
  ],
]

describe('a token a line break split is still removed whole', () => {
  it.each(SPLIT_BY_A_LINE_BREAK)('%s', (_name, raw, gone, placeholder) => {
    const out = redactedRaw(raw)
    for (const piece of gone) expect(out).not.toContain(piece)
    expect(out).toContain(placeholder)
  })

  it.each([
    ['a service named in a sentence', 'Booking .com said the room was free.'],
    ['two services', 'Hotels .com and Booking .com both had it.'],
    ['the word com', 'The word .com is on the sign.'],
    ['a typo', 'Typo like hotel .com is common.'],
    ['an extension named', 'This is the .info page.'],
    ['an app', 'The best .app we found.'],
    ['two extensions', 'Not a .bar or a .shop.'],
    ['two country codes', 'Chat in .de or .fr is fine.'],
    ['a verb and an extension', 'He wrote that .org is better.'],
    ['cash and de', 'We paid in cash .de was the plan.'],
    ['cash and co', 'We paid in cash .co was the plan.'],
  ])('leaves %s alone', (_name, text) => {
    const wrapped = inShortReview(text)
    expect(redacted(wrapped)).toBe(wrapped)
  })

  it.each([
    [
      'a word that introduces a domain',
      'Please visit booking.com for rooms.',
      'booking.com',
    ],
    [
      'a preposition before a domain',
      'We booked on booking.com and paid there.',
      'booking.com',
    ],
    ['a short word before a domain', 'You can see booking.com for rooms.', 'booking.com'],
    [
      'a sentence before an email',
      'Contact us. info@hotel.com for rooms.',
      'info@hotel.com',
    ],
  ])('takes only the contact after %s', (_name, text, contact) => {
    expect(redacted(text)).toBe(replacing(text, contact, '[CONTACT]'))
  })
})

/**
 * What a line break through the middle of a word still leaves. Pinned so that
 * closing one is a decision: a word in front of an email address
 * (`wrote owner@example.com`) cannot be told from the first half of its local
 * part, and a label split in two (`pa ssport`) is not a label.
 */
const BREAKS_THROUGH_A_WORD: ReadonlyArray<
  readonly [name: string, raw: string, left: string]
> = [
  [
    'a word of the local part of an email address',
    'Write to joh\nn.smith@gmail.com please, thank you very much for the lovely week.',
    'joh',
  ],
  [
    'the label of a passport number',
    'My pa\nssport X12345678 was checked at the lovely desk and the week was great.',
    'X12345678',
  ],
  [
    'the middle of an IPv6 address',
    'Their server 200\n1:db8::1 was down all week and the staff were lovely about it.',
    '200',
  ],
]

describe('a line break through a word still leaves these pieces (known gaps)', () => {
  it.each(BREAKS_THROUGH_A_WORD)('%s', (_name, raw, left) => {
    expect(redactedRaw(raw)).toContain(left)
  })
})

describe('the street types spelled out inside the patterns agree with the lists', () => {
  const expected = [...BASE_STREET_TYPE_WORDS, ...EXTRA_STREET_TYPE_WORDS].sort()

  function typesOf(patternId: string, anchor: string): readonly string[] {
    const source =
      ADDRESS_MARKER_PROFILE.patterns.find((entry) => entry.id === patternId)?.source ??
      ''
    const start = source.indexOf(anchor) + anchor.length
    return source.slice(start, source.indexOf(')', start)).split('|').sort()
  }

  it('spells out every type in the name-first pattern', () => {
    expect(typesOf('address_name_first', '{1,8})(')).toEqual(expected)
  })

  it('spells out every type in the pattern that rereads a shorter name', () => {
    expect(typesOf('address_name_first_reread', '{1,8})(')).toEqual(expected)
  })

  it('spells out every type in the number-last pattern', () => {
    expect(typesOf('address_number_last', '(?<![\\p{L}\\p{M}])(')).toEqual(expected)
  })
})

/**
 * A word of a street's name glued to the next by a full stop (`St.James`). Main
 * took the whole as a street; the first version of this repair read `St.James`
 * as a domain and left the house number and the street word in the text.
 */
const DOTTED_NAME_WORDS: readonly Shape[] = [
  ['St.James', 'We stayed at 12 St.James Street for a week.', '12 St.James Street'],
  ['N.Main', 'We stayed at 12 N.Main Street for a week.', '12 N.Main Street'],
  ['Mt.Vernon', 'We stayed at 5 Mt.Vernon Road for a week.', '5 Mt.Vernon Road'],
  ['Dr.Smith', 'We stayed at 10 Dr.Smith Place for a week.', '10 Dr.Smith Place'],
  ['O.Connell', 'We stayed at 12 O.Connell Street for a week.', '12 O.Connell Street'],
  ['U.S.Highway', 'We stayed at 3 U.S.Highway Road for a week.', '3 U.S.Highway Road'],
  ['lower case', 'We stayed at 7 st.john lane for a week.', '7 st.john lane'],
]

describe('a street name glued to a full stop is still an address', () => {
  it.each(DOTTED_NAME_WORDS)('%s', (_name, text, address) => {
    expect(redacted(text)).toBe(replacing(text, address, '[ADDRESS]'))
  })

  it('does not take a count glued to a sentence for a street', () => {
    const text = 'Stayed 12 nights.Staff were great near the road and the beach was fine.'
    expect(redacted(text)).not.toContain('[ADDRESS]')
  })
})

/**
 * Found by mutating sentences that hold personal data and comparing with main:
 * a capitalised word of the next sentence taken into a street-first name, a
 * Bulgarian street typed in lower case, an address inside markdown emphasis.
 */
const FUZZ_FINDINGS: readonly Shape[] = [
  [
    'a street first and the next sentence',
    'We stayed on 8 Place de la Concorde Would book again, a great room.',
    '8 Place de la Concorde',
  ],
  [
    'a street first with a number after, and the next sentence',
    'We found Avenue Louise 5 Would book again, a great room.',
    'Avenue Louise 5',
  ],
  [
    'a Bulgarian street in lower case in brackets',
    'Find us at <ул. витоша 25>, a nice room and a great stay with kind staff.',
    'ул. витоша 25',
  ],
  [
    'a Bulgarian street in lower case before a comma',
    'Find us at ул. витоша 25, a nice room and a great stay with kind staff.',
    'ул. витоша 25',
  ],
  [
    'an address in underscores',
    'The room was quiet. Visit _12 Love Lane_ near the beach and the pool.',
    '12 Love Lane',
  ],
]

describe('addresses a mutation of the sentence used to hide', () => {
  it.each(FUZZ_FINDINGS)('%s', (_name, text, address) => {
    expect(redacted(text, 'BG')).toBe(replacing(text, address, '[ADDRESS]'))
  })
})

/**
 * A capitalised unit or span of time before a drive, a way or a place is a street
 * unless a word that makes the number a measure stands in front of it (`Only`,
 * `is`, `within`, a determiner) or it starts a sentence. The first version of
 * this repair read it as a clause wherever it stood.
 */
const UNIT_STREETS_AFTER_ANY_LEAD: readonly Shape[] = [
  [
    'Taxi to',
    'Great stay and a clean room. Taxi to 7 Days Way near the beach.',
    '7 Days Way',
  ],
  [
    'Visit',
    'Great stay and a clean room. Visit 3 Weeks Place near the beach.',
    '3 Weeks Place',
  ],
  [
    'Directions:',
    'Great stay and a clean room. Directions: 50 Feet Drive near the beach.',
    '50 Feet Drive',
  ],
  [
    'booked',
    'Great stay and a clean room. We booked 12 Hour Way for a week.',
    '12 Hour Way',
  ],
  [
    'in capitals',
    'Great stay and a clean room. Come to 5 TIMES WAY for a week.',
    '5 TIMES WAY',
  ],
  [
    'in brackets',
    'Great stay and a clean room. We went to (221 Stars Drive) for a week.',
    '221 Stars Drive',
  ],
]

describe('a capitalised unit name before a drive, a way or a place is a street', () => {
  it.each(UNIT_STREETS_AFTER_ANY_LEAD)('%s', (_name, text, address) => {
    expect(redacted(text)).toBe(replacing(text, address, '[ADDRESS]'))
  })

  it.each([
    'It is 5 Minutes Drive from the beach and the staff booked a taxi.',
    'The old town is 2 Days Drive from here, which the kids liked a lot.',
    'The trip takes 3 Hours Drive and the road was quiet all the way.',
    '5 Minutes Drive from the beach and the staff booked us a taxi.',
    'Great stay and a clean room. 5 Minutes Drive from the beach, lovely.',
    'Within 10 Minutes Drive there is a shop and a pharmacy for the guests.',
  ])('still reads a title-case measure as a measure: %s', (text) => {
    expect(redacted(text)).toBe(text)
  })
})
