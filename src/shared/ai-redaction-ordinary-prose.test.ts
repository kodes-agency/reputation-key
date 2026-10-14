import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
import { NETWORK_MARKER_PROFILE } from './ai-network-markers'
import { canonicalizeRawAiReviewSource } from './ai-review-source-contract'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'

function redact(text: string, countryCode = 'US') {
  return redactAiReviewText({
    text,
    countryCode,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
}

function redacted(text: string, countryCode = 'US'): string {
  const result = redact(text, countryCode)
  if (result.status !== 'redacted') {
    throw new Error(`expected a redacted result, got ${result.status}:${result.reason}`)
  }
  return result.text
}

/** Ordinary review prose: nothing in it is personal data, so it must pass untouched. */
const UNTOUCHED_PROSE: ReadonlyArray<readonly [string, string]> = [
  [
    'a long review holding a digit and the word street',
    'Stayed here for 3 nights with my wife and kids in July. The room was clean, the breakfast was fresh and varied, and the staff went out of their way to help with the luggage. The only complaint is the noise from the street at night, which made it hard to sleep with the window open. We would still come back.',
  ],
  [
    'a long review holding a digit and the word place',
    'We booked 2 rooms for a family weekend and I would not stay at any other place in town. The beds were comfortable, the pool was warm, the staff remembered our names and the restaurant on the ground floor served a generous dinner. Parking was easy, the lobby smelled of fresh coffee and the check-out took a minute.',
  ],
  [
    'a long review holding a digit and the word way',
    'Great hotel overall. 5 stars from us for the helpful reception, the quiet rooms and the rooftop terrace with a view of the old town. The shuttle to the station runs every half hour, which is a great way to avoid the taxi queue, and the buffet breakfast had something for everyone, including the kids.',
  ],
  [
    'a 10 minute drive',
    'The beach is a 10 minute drive from the hotel and the staff booked us a taxi.',
  ],
  [
    'a 5 minute walk',
    'Lovely spot, a 5 minute walk to the beach by way of the old street market.',
  ],
  [
    'weeks and a wonderful place',
    'We spent 2 weeks here and it was a wonderful place with lovely staff',
  ],
  [
    'courses and all the way',
    'We had 3 courses and the waiter was rude all the way through, terrible dinner',
  ],
  ['visits and the place', 'We visited 4 times and loved the place'],
  ['stars and a great place', '5 stars great place, friendly staff and a quiet room'],
  [
    'nights and a lovely place',
    'Stayed 2 nights. Lovely place. Friendly staff and spotless rooms.',
  ],
  [
    'a 2 bedroom place',
    'A lovely 2 bedroom place with a big balcony and a very helpful host',
  ],
  [
    'a decimal rating',
    'Rated 4.5 out of 5 by our group, and the food was worth every cent of it.',
  ],
  [
    'a price and a duration',
    'Paid 9.99 for a coffee and waited 2.5 hours for the bill at the end',
  ],
  [
    'a decimal next to a street word',
    'We waited 2.5 hours for a table at this place and the food was cold.',
  ],
  [
    'a fare next to the word way',
    'It cost 4.5 euros each way by bus, a fair price for the trip to the old town.',
  ],
  [
    'a dotted date and an abbreviation',
    'Dinner on 12.05.2024 at the place was lovely and the music was nice, i.e. not too loud.',
  ],
  [
    'a.m. and p.m.',
    'Check-in is at 11 a.m. and check-out is at 3 p.m. which suits us well.',
  ],
  [
    'a ratio and a version-like number',
    'Room 12 had a 2.4 GHz network and 1.5 km to the center.',
  ],
  [
    'title-case minutes and a drive',
    'Only 2 Minutes Drive from the beach and the staff booked us a taxi.',
  ],
  [
    'a title-case minute drive',
    'It was a 15 Minute Drive to the old town and worth every minute.',
  ],
  [
    'title-case nights and a lovely place',
    'We stayed 3 Nights In A Lovely Place with a very friendly host.',
  ],
  [
    'all-capitals stars and a great place',
    '5 STARS GREAT PLACE, SPOTLESS ROOMS AND FRIENDLY STAFF',
  ],
  ['a rating and all-capitals praise', '10/10 GREAT PLACE AND LOVELY STAFF'],
  [
    'a score given for the place',
    'I give it 10 for this place, the staff were kind and the room was quiet.',
  ],
  [
    'a rating and praise without a comma',
    'Location 10 amazing place with a pool and a quiet garden',
  ],
  [
    'a line speed and the word way',
    'Wifi 10 mbps way better than at home, no drops at all.',
  ],
  [
    'title-case nights near a street',
    'Stayed 5 Nights Near Main Street and walked everywhere.',
  ],
  [
    'all-capitals nights near a street',
    'WE STAYED 5 NIGHTS NEAR MAIN STREET AND LOVED IT',
  ],
  ['all-capitals place to stay', 'TOP 10 PLACE TO STAY IN SOFIA, HONESTLY'],
  [
    'euros each way and a lane',
    'Paid 5 bucks each way, and the bus lane was empty all morning.',
  ],
]

describe('redaction leaves ordinary review prose alone', () => {
  it.each(UNTOUCHED_PROSE)('%s', (_name, text) => {
    expect(redact(text)).toEqual({
      status: 'redacted',
      text,
      counts: {
        '[PERSON]': 0,
        '[CONTACT]': 0,
        '[ADDRESS]': 0,
        '[FINANCIAL]': 0,
        '[IDENTIFIER]': 0,
        '[SECRET]': 0,
      },
    })
  })

  it('leaves a Bulgarian date and the abbreviations t.e. and t.n. alone', () => {
    const text =
      'Престояхме на 12.05.2024 в стая с изглед към морето, т.е. нямахме проблем с шума, а закуската беше богата, т.н. сирена и сладки.'
    expect(redacted(text, 'BG')).toBe(text)
  })
})

/** The same detectors must still catch what they exist for. */
const CAUGHT: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a street address in a long review',
    'We stayed 3 nights and the hotel at 25 Main Street was easy to find, with a quiet room, a friendly desk, a big breakfast and a pool that the kids loved. Everything was clean, the staff were kind and we would gladly come back again next summer with our friends.',
    '25 Main Street',
  ],
  [
    'a street address with a postal code',
    'Send the receipt to 1600 Pennsylvania Avenue, 20500 please.',
    '1600 Pennsylvania Avenue, 20500',
  ],
  [
    'a lowercase street address',
    'it is at 25 main street near the station',
    '25 main street',
  ],
  [
    'an abbreviated street address',
    'We met at 12 Baker St before dinner.',
    '12 Baker St',
  ],
  [
    'a boulevard address',
    'The office is at 4300 Sunset Boulevard on the left.',
    '4300 Sunset Boulevard',
  ],
  ['a court address', 'Find us at 7 Maple Court, the green door.', '7 Maple Court'],
]

describe('redaction still removes real addresses', () => {
  it.each(CAUGHT)('%s', (_name, text, address) => {
    const out = redacted(text)
    expect(out).not.toContain(address)
    expect(out).toContain('[ADDRESS]')
  })
})

/** A review long enough that one replaced address never trips the ratio rule. */
function inReview(clause: string): string {
  return `The room was quiet, the breakfast was fresh and the staff were kind. ${clause} We would gladly come back with our friends next summer.`
}

/**
 * Addresses typed the way a guest types them: any case, particles in the name,
 * the street-type word before the name. Each is replaced exactly, and what
 * follows the address (a city, a country code) is left alone.
 */
const ADDRESS_LAYOUTS: ReadonlyArray<readonly [string, string, string]> = [
  ['a lower-case lane', 'The guest lives at 7 oak lane and sent a note.', '7 oak lane'],
  ['an abbreviated lane', 'Please post it to 7 oak ln before Friday.', '7 oak ln'],
  ['a lower-case drive', 'The villa is at 3 ocean drive near the pier.', '3 ocean drive'],
  ['an abbreviated drive', 'The villa is at 3 ocean dr near the pier.', '3 ocean dr'],
  ['a lower-case way', 'They moved to 17 beech way last spring.', '17 beech way'],
  ['a lower-case way and a city', 'It is 42 wallaby way sydney.', '42 wallaby way'],
  ['a lower-case lane in the city', 'A flat at 5 park lane is for sale.', '5 park lane'],
  ['a green lane', 'We met up at 8 green lane for lunch.', '8 green lane'],
  [
    'a lower-case court',
    'Find the office at 5 highfield court on Monday.',
    '5 highfield court',
  ],
  ['a capitalised lane', 'We stayed with friends at 7 Oak Lane in May.', '7 Oak Lane'],
  ['a capitalised drive', 'Meet me at 4 Privet Drive after work.', '4 Privet Drive'],
  [
    'a capitalised way',
    'The studio is at 42 Wallaby Way for the shoot.',
    '42 Wallaby Way',
  ],
  [
    'a name with particles',
    'Send it to 12 de la Rosa Street please.',
    '12 de la Rosa Street',
  ],
  [
    'a long lower-case name',
    'They live at 12 martin luther king jr street now.',
    '12 martin luther king jr street',
  ],
  [
    'a long capitalised name with an abbreviation',
    'Find us at 12 Martin Luther King Jr. Boulevard today.',
    '12 Martin Luther King Jr. Boulevard',
  ],
  [
    'a five-word capitalised name',
    'The office is at 100 Martin Luther King Jr Memorial Boulevard today.',
    '100 Martin Luther King Jr Memorial Boulevard',
  ],
  [
    'a house number with a letter',
    'Deliver it to 221B Baker Street today.',
    '221B Baker Street',
  ],
  ['an ordinal avenue', 'The office is at 350 5th Ave on the corner.', '350 5th Ave'],
  [
    'a street first, a boulevard',
    'The hotel is at 100 Boulevard Saint-Germain, Paris, near the river.',
    '100 Boulevard Saint-Germain',
  ],
  [
    'a street first, an avenue and a postal code',
    'Post it to 5 Avenue Victor Hugo, 75016 Paris, thank you.',
    '5 Avenue Victor Hugo, 75016',
  ],
  [
    'a street first, a place and particles',
    'We dined at 8 Place de la Concorde on Friday.',
    '8 Place de la Concorde',
  ],
  [
    'a street first, an abbreviated place',
    'We dined at 8 Pl. de la Concorde on Friday.',
    '8 Pl. de la Concorde',
  ],
  [
    'a street first in capitals',
    'We dined at 8 PLACE DE LA CONCORDE on Friday.',
    '8 PLACE DE LA CONCORDE',
  ],
  [
    'a street first with a connector in the name',
    'We stayed at 1 Avenue of the Americas last year.',
    '1 Avenue of the Americas',
  ],
]

describe('redaction removes an address in any of the layouts a guest types', () => {
  it.each(ADDRESS_LAYOUTS)('%s', (_name, clause, address) => {
    const text = inReview(clause)
    expect(redacted(text)).toBe(text.replace(address, '[ADDRESS]'))
  })
})

describe('the connector words of a street name', () => {
  // The street-first pattern spells the connectors out in its own source; the
  // list in the profile is what the name-first rule reads. They must agree.
  it.each(ADDRESS_MARKER_PROFILE.wordLists.nameConnectors)(
    'keeps "%s" inside a street-first and a name-first street name',
    (connector) => {
      for (const address of [
        `8 Avenue Foo ${connector} Bar`,
        `8 Foo ${connector} Bar Street`,
      ]) {
        const text = inReview(`We dined at ${address} on Friday.`)
        expect(redacted(text)).toBe(text.replace(address, '[ADDRESS]'))
      }
    },
  )
})

/**
 * Address shapes the detector does not take, on purpose or for lack of a rule.
 * Pinned so that adding one later is a decision, not an accident; the same list
 * is in `src/contexts/ai/CONTEXT.md` ("Source text").
 */
const NOT_DETECTED_ADDRESSES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a street word with no English type word',
    'We stayed at 16 rue de rivoli last week.',
    'US',
  ],
  [
    'a street written after its number in lower case',
    'We met at main street 25 near the station.',
    'US',
  ],
  [
    'a lower-case name holding all',
    'The villa is at 12 all saints road near the pier.',
    'US',
  ],
  [
    'a lower-case name holding under',
    'The villa is at 12 under hill street near the pier.',
    'US',
  ],
  [
    'a lower-case name that is a count before a drive',
    'The villa is at 12 star drive near the pier.',
    'US',
  ],
  [
    'a lower-case name that is praise before a place',
    'The villa is at 12 love place near the pier.',
    'US',
  ],
]

describe('redaction does not take these address shapes (known gaps)', () => {
  it.each(NOT_DETECTED_ADDRESSES)('%s', (_name, text, countryCode) => {
    expect(redacted(inReview(text), countryCode)).toBe(inReview(text))
  })
})

const COORDINATE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a pair followed by a space',
    'Our pin is 42.6977, 23.3219 near the gate.',
    '42.6977, 23.3219',
  ],
  ['a pair ending a sentence', 'Our pin is 42.6977, 23.3219.', '42.6977, 23.3219'],
  [
    'a six-decimal pair ending a sentence',
    'Pin 42.697712, 23.321912.',
    '42.697712, 23.321912',
  ],
  ['a negative pair ending a sentence', 'Pin -33.8688, 151.2093.', '-33.8688, 151.2093'],
  ['a pair before a comma', 'Pin 42.6977, 23.3219, then left.', '42.6977, 23.3219'],
]

describe('redaction removes a coordinate pair wherever it sits', () => {
  it.each(COORDINATE_PAIRS)('%s', (_name, text, pair) => {
    expect(redacted(inReview(text))).toBe(inReview(text).replace(pair, '[ADDRESS]'))
  })

  it('leaves a longer dotted number alone', () => {
    const text = inReview('Build 42.6977, 23.3219.5 shipped on Friday.')
    expect(redacted(text)).toBe(text)
  })
})

const DOMAINS: ReadonlyArray<readonly [string, string, string]> = [
  ['a plain domain', 'Book on hotel-sofia.bg for the best price.', 'hotel-sofia.bg'],
  [
    'a well-known booking domain',
    'We found it on booking.com last week and it was fine.',
    'booking.com',
  ],
  [
    'a mixed-case domain',
    'Visit Example.COM for more details about the rooms.',
    'Example.COM',
  ],
  [
    'a Cyrillic domain',
    'Резервирайте на хотел-пример.бг още днес, моля.',
    'хотел-пример.бг',
  ],
  [
    'a sub-domain',
    'Menu at menu.restaurant-roma.co.uk is up to date.',
    'menu.restaurant-roma.co.uk',
  ],
]

describe('redaction still removes real domains', () => {
  it.each(DOMAINS)('%s', (_name, text, domain) => {
    const out = redacted(text, 'BG')
    expect(out).not.toContain(domain)
    expect(out).toContain('[CONTACT]')
  })

  it.each([
    [
      'an email at a numeric host',
      'Write to guest@192.0.2.55 please',
      'guest@192.0.2.55',
    ],
    [
      'a URL at a numeric host',
      'See http://192.0.2.55/menu for details',
      'http://192.0.2.55/menu',
    ],
    ['an email at a one-letter host', 'Mail me at me@x.io about this', 'me@x.io'],
  ] as const)('%s', (_name, text, contact) => {
    const out = redacted(text)
    expect(out).not.toContain(contact)
    expect(out).toContain('[CONTACT]')
  })
})

/**
 * Known, accepted: a bare domain is told from prose by its last label, so a
 * word glued to a full stop (`hotel.Staff`) or a title glued to a name
 * (`Dr.Smith`) still reads as a domain. Nothing separates them from
 * `example.Com`, and a guest on a phone can type `Booking.Com`. A rule that
 * accepted only a lower-case or all-capitals last label would stop this and
 * start leaking `Booking.Com`; that choice belongs to the owner.
 */
const READ_AS_DOMAIN: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a missing space after a full stop',
    'The room was clean and quiet. Nice hotel.Staff friendly and kind, breakfast was fresh.',
    'hotel.Staff',
  ],
  [
    'a title glued to a name',
    'The room was clean and quiet. Dr.Smith was kind and the breakfast was fresh.',
    'Dr.Smith',
  ],
]

describe('redaction reads a glued word as a domain (known, accepted)', () => {
  it.each(READ_AS_DOMAIN)('%s', (_name, text, glued) => {
    expect(redacted(text)).toBe(text.replace(glued, '[CONTACT]'))
  })
})

describe('redaction stays closed on an address it cannot bound', () => {
  it('blocks a street whose name outgrows the 256-scalar candidate cap', () => {
    const text = `We stayed at 5 A${'b'.repeat(300)} Street for the weekend and it was fine.`
    expect(redact(text)).toEqual({
      status: 'redaction_blocked',
      reason: 'ambiguous_candidate',
    })
  })

  it('no longer blocks a long review merely for holding a digit and a street word', () => {
    const filler = 'The room was quiet and the staff were kind. '.repeat(8)
    const result = redact(`${filler}We stayed 2 nights near the street market.`)
    expect(result.status).toBe('redacted')
  })
})

/*
 * What the branch must keep removing that main removed, found by an independent
 * privacy check of the first version of this fix (review 2026-10-14, S05-01 to
 * S05-04). Main caught most of these by accident (the bare-domain rule took
 * every decimal, the address pattern took any words, a review over 256
 * characters with a digit and a street word was blocked), and the first version
 * of the fix let them reach the provider. Each shape is tested twice: in a short
 * review and in a long one, the condition under which main blocked.
 */
const LONG_LEAD =
  'We stayed 3 nights and the room was clean, the breakfast was fresh and the staff were kind. The pool was warm every afternoon and the garden was quiet, so we would happily come back next year with the whole family and our friends. '

function inLongReview(clause: string): string {
  return `${LONG_LEAD}${clause} The rest of the stay was lovely and we recommend it.`
}

const REVIEW_SIZES: ReadonlyArray<readonly [string, (clause: string) => string]> = [
  ['in a short review', inReview],
  ['in a long review', inLongReview],
]

describe('the long review used by these tests is past the 256-scalar line main blocked at', () => {
  it('holds more than 256 scalars, a digit and a street word', () => {
    const text = inLongReview('We found it at 5 Oak Road.')
    expect([...text].length).toBeGreaterThan(256)
    expect(text).toMatch(/\d/)
  })
})

/** [name, address exactly as a guest writes it]. Each must be replaced whole. */
const EVERYDAY_WORD_STREETS: ReadonlyArray<readonly [string, string]> = [
  ['a street named Love', '1 Love Lane'],
  ['a street named Friendly', '30 Friendly Way'],
  ['a street named Golf Course', '12 Golf Course Drive'],
  ['a street named Great', '4 Great Court'],
  ['a street named Central, drive', '5 Central Drive'],
  ['a street named Central, way', '14 Central Way'],
  ['a street named Central, court', '3 Central Court'],
  ['a street named Central, place', '10 Central Place'],
  ['a street named Central, lane', '2 Central Lane'],
  ['a street named Pound', '8 Pound Lane'],
  ['a street named Fox and Hounds', '4 Fox and Hounds Lane'],
  ['a street named Top of the Hill', '6 Top of the Hill Drive'],
  ['a street named All Saints', '17 All Saints Way'],
  ['a street named Up Hill', '1 Up Hill Drive'],
  ['a street named Mile High', '123 Mile High Drive'],
  ['a street named Day', '88 Day Lane'],
  ['a street named Great Place', '12 Great Place'],
  ['a street named Love in capitals', '1 LOVE LANE'],
  ['a street named Friendly in capitals', '30 FRIENDLY WAY'],
  ['a street named Star in capitals', '6 STAR STREET'],
]

/** Streets whose name is a counted unit: a mile, a star, a pound. */
const COUNTED_UNIT_STREETS: ReadonlyArray<readonly [string, string]> = [
  ['Mile Road', '8 Mile Road'],
  ['Mile End Road', '100 Mile End Road'],
  ['Star Street', '6 Star Street'],
  ['Pound Lane', '10 Pound Lane'],
  ['Mile Road in capitals', '8 MILE ROAD'],
  ['Mile End Road in lower case', '9 mile end road'],
  ['Star Street in lower case', '6 star street'],
  ['Mile End Road with a postcode', '15 Mile End Road, London E1 4NS'],
]

/** Typed in lower case: the street word is what makes it an address. */
const LOWER_CASE_STREETS: ReadonlyArray<readonly [string, string]> = [
  ['a name holding the', '12 the old mill road'],
  ['a name holding the, lane', '14 the green lane'],
  ['the alone', '10 the avenue'],
  ['a name holding course', '12 golf course road'],
  ['a name that is a direction word', '12 down street'],
  ['a dotted initial', '42 n. main st'],
  ['a dotted initial and an ordinal', '1234 w. 5th ave'],
  ['a dotted title', '12 mt. vernon road'],
  ['a dotted fort', '12 ft. lauderdale ave'],
  ['a dotted doctor', '5 dr. martin luther king blvd'],
  ['a dotted saint', "12 st. john's street"],
  ['a saint with of', '34 saint john of god road'],
  ['five name words', '12 martin luther king jr memorial way'],
  ['six name words', '1 rev dr martin luther king jr boulevard'],
  ['a street first', '100 boulevard haussmann'],
  ['a street first with particles', '8 place de la concorde'],
]

/** Layouts a guest types that the plain "number name type" pattern cannot read. */
const OTHER_LAYOUTS: ReadonlyArray<readonly [string, string]> = [
  ['the number last', 'Main Street 25'],
  ['the number last, a road', 'Oak Road 12'],
  ['the number last, a lane', 'Park Lane 7'],
  ['the number last with a letter', 'Baker Street 221B'],
  ['the number last after a comma', 'High Street, 12'],
  ['the number last after no.', 'Station Road no. 5'],
  ['the number last after No', "Queen's Road No 7"],
  ['the number last, abbreviated', 'Vitosha Blvd 18'],
  ['the number last with a street first', 'Pl. de Catalunya 5'],
  ['a comma after the number', '12, Oak Road'],
  ['a dash after the number', '12 - Oak Road'],
  ['no space after the number', '12Oak Road'],
  ['a number written out', 'Twelve Oak Road'],
]

/** What follows the street on the same line: a city, a state, a postcode. */
const POSTAL_TAILS: ReadonlyArray<readonly [string, string]> = [
  ['a London postcode', '12 High Street, London W1D 3AF'],
  ['a London postcode after a block', '221B Baker Street, NW1 6XE'],
  ['an Australian state and postcode', '45 Beach Road, Sydney NSW 2000'],
  ['a Washington state and zip', '1600 Pennsylvania Avenue NW, Washington DC 20500'],
  ['a US state and zip', '12 Oak Road, Springfield, IL 62704'],
  ['a Mayfair postcode', '5 Park Lane, London W1K 7TN'],
  ['a Bulgarian city and code', '18 Beach Road, Varna 9000'],
  ['a New York zip', '1 West 34th Street, New York, NY 10019'],
]

/** Bulgarian street words, number last: the Property market. */
const BULGARIAN_STREETS: ReadonlyArray<readonly [string, string]> = [
  ['ул. before the name', 'ул. Витоша 25'],
  ['бул. before the name', 'бул. Витоша 100'],
  ['ул. with quotation marks', 'ул. „Граф Игнатиев“ 12'],
  ['a district and a street', 'ж.к. Лозенец, ул. Златоврах 5'],
  ['ul. in Latin letters', 'ul. Vitosha 25'],
  ['bul. in Latin letters', 'bul. Vitosha 100'],
]

describe.each(REVIEW_SIZES)('a real address is replaced whole %s', (_size, wrap) => {
  const groups: ReadonlyArray<
    readonly [string, ReadonlyArray<readonly [string, string]>]
  > = [
    ['everyday-word street', EVERYDAY_WORD_STREETS],
    ['counted-unit street', COUNTED_UNIT_STREETS],
    ['lower-case street', LOWER_CASE_STREETS],
    ['other layout', OTHER_LAYOUTS],
    ['postal tail', POSTAL_TAILS],
  ]
  for (const [group, cases] of groups) {
    it.each(cases)(`${group}: %s`, (_name, address) => {
      const text = wrap(`Our taxi left us at ${address}.`)
      expect(redacted(text)).toBe(text.replace(address, '[ADDRESS]'))
    })
  }

  it.each(BULGARIAN_STREETS)('Bulgarian street: %s', (_name, address) => {
    const text = wrap(`Our taxi left us at ${address}.`)
    expect(redacted(text, 'BG')).toBe(text.replace(address, '[ADDRESS]'))
  })
})

describe('a street with a unit before it is replaced up to its postcode', () => {
  it.each([
    ['Flat 4, 12 High Street, London W1D 3AF', '12 High Street, London W1D 3AF'],
    ['Apt 5B, 221B Baker Street, NW1 6XE', '221B Baker Street, NW1 6XE'],
    ['Hotel Sunrise, 18 Beach Road, Varna 9000', '18 Beach Road, Varna 9000'],
  ] as const)('%s', (clause, address) => {
    const text = inLongReview(`Our taxi left us at ${clause}.`)
    expect(redacted(text)).toBe(text.replace(address, '[ADDRESS]'))
  })
})

const ORDINARY_STREET_NAMES = [
  'Main',
  'Church',
  'High',
  'Park',
  'Oak',
  'Pine',
  'Maple',
  'Cedar',
  'Elm',
  'Washington',
  'Lake',
  'Hill',
  'Second',
  'Walnut',
  'Sunset',
  'Highland',
  'Mill',
  'Station',
  'Victoria',
  'King',
  'Green',
  'Spring',
  'North',
  'Chestnut',
  'Willow',
  'Lincoln',
  'River',
  'Ridge',
  'Meadow',
  'Cherry',
  'School',
  'Market',
  'Bridge',
  'New',
  'Old',
  'Manor',
  'Orchard',
  'Garden',
  'Rose',
  'Oxford',
  'Cambridge',
  'Broad',
  'Long',
  'Beach',
  'Harbour',
  'Castle',
  'Abbey',
  'Vine',
  'Brook',
  'Valley',
  'Ocean',
  'Union',
  'Liberty',
  "O'Connell",
  'De La Rosa',
]
/** Real street names that read like everyday words, none holding a glue word. */
const EVERYDAY_STREET_NAMES = [
  'Love',
  'Hope',
  'Good',
  'Great',
  'Pleasant',
  'Quiet',
  'Central',
  'Best',
  'Kind',
  'Friendly',
  'Clean',
  'Mile',
  'Mile End',
  'Star',
  'Pound',
  'Day',
  'Time',
  'Week',
  'Year',
  'Night',
  'Bed',
  'Room',
  'Step',
  'Guest',
  'Block',
  'Course',
  'Golf Course',
  'Floor',
  'Down',
  'Up',
  'Over',
  'Under',
  'Out',
  'Off',
  'Near',
  'Past',
  'After',
  'Before',
  'The Old Mill',
  'The Green',
  'The',
  'Of',
  'Our',
  'My',
  'Your',
  'Their',
  'This',
  'That',
  'Lane Cove',
  'Way',
  'All Saints',
  'Every',
  'Each',
  'More',
  'Only',
  'Per',
  'Same',
  'Other',
  'Under Hill',
  'Hill Top',
  'Top',
  'Perfect',
  'Worth',
  'Super',
  'Super Cheap',
  'Nice',
  'Charming',
  'Beautiful',
  'Modern',
]
const STREET_TYPES = [
  'Street',
  'St',
  'Road',
  'Rd',
  'Avenue',
  'Ave',
  'Boulevard',
  'Blvd',
  'Lane',
  'Ln',
  'Drive',
  'Dr',
  'Way',
  'Court',
  'Ct',
  'Place',
  'Pl',
]
const OPEN_STREET_TYPES = [
  'Street',
  'St',
  'Road',
  'Rd',
  'Avenue',
  'Ave',
  'Boulevard',
  'Blvd',
]
const HOUSE_NUMBERS = ['12', '7', '221', '1400']
/**
 * Everyday-word names that hold a glue word (`all`, `under`, `more`, `lane`), or
 * are one. Typed in lower case they read as a clause (`1 more street`, `a 2 lane
 * road`) and are left alone; capitalised they are streets. Pinned below.
 */
const LOWER_CASE_GLUE_NAMES: ReadonlySet<string> = new Set([
  'Of',
  'Lane Cove',
  'Way',
  'All Saints',
  'Every',
  'Each',
  'More',
  'Only',
  'Per',
  'Same',
  'Other',
  'Under Hill',
])

/** Every name x type x number x case that is not removed, as readable strings. */
function leakedAddresses(
  names: readonly string[],
  types: readonly string[],
  caseOf: (value: string) => string,
): readonly string[] {
  const leaked: string[] = []
  for (const name of names) {
    for (const type of types) {
      for (const number of HOUSE_NUMBERS) {
        const address = caseOf(`${number} ${name} ${type}`)
        const text = inReview(`We stayed at ${address} last month.`)
        const out = redact(text)
        if (out.status === 'redacted' && !out.text.includes(address)) continue
        leaked.push(address)
      }
    }
  }
  return leaked
}

describe('every street name and type the privacy check generated is removed', () => {
  it.each([
    ['title case', (value: string) => value],
    ['all capitals', (value: string) => value.toUpperCase()],
  ])('ordinary names, %s', (_case, caseOf) => {
    const names = ORDINARY_STREET_NAMES.filter((name) => name !== 'De La Rosa')
    expect(leakedAddresses(names, STREET_TYPES, caseOf)).toEqual([])
  })

  it('ordinary names, lower case', () => {
    const names = ORDINARY_STREET_NAMES.map((name) => name.toLowerCase())
    expect(leakedAddresses(names, STREET_TYPES, (value) => value.toLowerCase())).toEqual(
      [],
    )
  })

  it.each([
    ['title case', (value: string) => value],
    ['all capitals', (value: string) => value.toUpperCase()],
  ])('everyday-word names, %s', (_case, caseOf) => {
    expect(leakedAddresses(EVERYDAY_STREET_NAMES, STREET_TYPES, caseOf)).toEqual([])
  })

  it('everyday-word names before a street, road, avenue or boulevard, lower case', () => {
    const names = EVERYDAY_STREET_NAMES.filter((name) => !LOWER_CASE_GLUE_NAMES.has(name))
    expect(
      leakedAddresses(
        names.map((name) => name.toLowerCase()),
        OPEN_STREET_TYPES,
        (value) => value.toLowerCase(),
      ),
    ).toEqual([])
  })

  it('everyday-word names before a lane or a court, lower case, except a count', () => {
    const names = EVERYDAY_STREET_NAMES.filter(
      (name) =>
        !LOWER_CASE_GLUE_NAMES.has(name) && !/^(The|Our|My|Your|Their)/u.test(name),
    )
    expect(
      leakedAddresses(
        names.map((name) => name.toLowerCase()),
        ['Lane', 'Ln', 'Court', 'Ct'],
        (value) => value.toLowerCase(),
      ),
    ).toEqual([])
  })
})

const COORDINATE_LAYOUTS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a pair glued to the word before it by a full stop',
    'The coordinates.42.6977, 23.3219 are on the sign.',
    '42.6977, 23.3219',
  ],
  [
    'hemisphere letters before the numbers',
    'The beach house has its own cove. GPS N 42.6977 E 23.3219',
    'N 42.6977 E 23.3219',
  ],
  [
    'lat and lon labels',
    'Great location. We parked at lat 42.6977 lon 23.3219 and walked down.',
    'lat 42.6977 lon 23.3219',
  ],
  [
    'labels with an equals sign',
    'Great location. We parked at lat=42.6977,lng=23.3219 and walked down.',
    'lat=42.6977,lng=23.3219',
  ],
  [
    'a semicolon between the numbers',
    'The beach house has its own cove. GPS 42.6977; 23.3219',
    '42.6977; 23.3219',
  ],
  [
    'a space between the numbers',
    'The hotel is easy to find, the pin is at 42.6977 23.3219 and the entrance faces the garden.',
    '42.6977 23.3219',
  ],
  [
    'degree signs',
    'The beach house has its own cove. GPS 42.6977°, 23.3219°',
    '42.6977°, 23.3219°',
  ],
  [
    'three decimals',
    'The hotel is easy to find, the pin is at 42.697, 23.321 and the entrance faces the garden.',
    '42.697, 23.321',
  ],
  [
    'comma decimals and a semicolon',
    'Great location. We parked at 42,6977; 23,3219 and walked down.',
    '42,6977; 23,3219',
  ],
]

describe('redaction removes a coordinate pair written in any common layout', () => {
  it.each(COORDINATE_LAYOUTS)('%s', (_name, text, pair) => {
    const wrapped = inReview(text)
    expect(redacted(wrapped)).toBe(wrapped.replace(pair, '[ADDRESS]'))
  })

  it.each([
    ['one-decimal ratings', 'Rated 4.5, 3.8 and 4.2 by our family, a quiet place.'],
    ['two-decimal prices', 'Prices were 12.50, 14.75 and 9.99 for the three menus.'],
    ['a version number', 'The kiosk ran version 1.2.3 and then 2.4.5 after the update.'],
  ])('leaves %s alone', (_name, text) => {
    const wrapped = inReview(text)
    expect(redacted(wrapped)).toBe(wrapped)
  })
})

const IP_LAYOUTS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a port',
    'The portal kept redirecting me to 192.0.2.55:8080 which looked odd.',
    '192.0.2.55:8080',
  ],
  [
    'a short port',
    'The portal kept redirecting me to 203.0.113.9:22 which looked odd.',
    '203.0.113.9:22',
  ],
  [
    'an IP: label',
    'The portal kept redirecting me to IP:203.0.113.9 which looked odd.',
    '203.0.113.9',
  ],
  [
    'trailing dots',
    'The portal kept redirecting me to 203.0.113.9... which looked odd.',
    '203.0.113.9',
  ],
  [
    'an IPv6 address with a port',
    'The portal kept redirecting me to [2001:db8::1]:443 which looked odd.',
    '[2001:db8::1]:443',
  ],
]

describe('redaction removes an IP address with a port, a label or trailing dots', () => {
  it.each(IP_LAYOUTS)('%s', (_name, text, address) => {
    const wrapped = inReview(text)
    const out = redacted(wrapped)
    expect(out).not.toContain(address.replace(/^\[|\]:\d+$/gu, ''))
    expect(out).toContain('[CONTACT]')
  })

  it('leaves a version-like number with fewer than four parts alone', () => {
    const wrapped = inReview('The kiosk ran version 1.2.3 and the Wi-Fi 6.5 was fast.')
    expect(redacted(wrapped)).toBe(wrapped)
  })
})

describe('redaction removes a domain whose dot was separated by a line break', () => {
  it('reads the canonical text of hotelsunrise, a line break, .com', () => {
    const canonical = canonicalizeRawAiReviewSource({
      text: 'Great stay, kind staff. See hotelsunrise\n.com for the rooms.',
      rating: 5,
      languageCode: 'en',
      reviewedAtEpochMillis: 1_700_000_000_000,
      reviewerDisplayName: null,
    }).text
    expect(canonical).toBe('Great stay, kind staff. See hotelsunrise .com for the rooms.')
    expect(redacted(canonical ?? '')).toBe(
      'Great stay, kind staff. See [CONTACT] for the rooms.',
    )
  })

  it.each([
    [
      'a letter and a digit in the last label',
      'Lovely stay, see hotel.c0m, they have photos.',
      'hotel.c0m',
    ],
  ])('%s', (_name, text, domain) => {
    expect(redacted(text)).toBe(text.replace(domain, '[CONTACT]'))
  })

  it('leaves a word and a sentence with a stray space before the full stop alone', () => {
    const text = 'The room was clean and quiet .Thanks for everything, see you next year.'
    expect(redacted(text)).toBe(text)
  })
})

/** Prose the wider address rules must still leave alone. */
const STILL_PROSE: ReadonlyArray<readonly [string, string]> = [
  [
    'a room number and praise in capitals',
    'ROOM 305 WAS A GREAT PLACE, CLEAN AND QUIET WITH A LOVELY GARDEN',
  ],
  [
    'a room number and praise in title case',
    'Room 305 Was A Great Place With A Quiet Garden And Kind Staff',
  ],
  [
    'doors down the road',
    'There is a lovely bakery 2 doors down the road from the hotel entrance.',
  ],
  [
    'blocks from the street',
    'The hotel is 3 blocks from the main street and a short walk from the beach.',
  ],
  [
    'a street name and a count of times',
    'We parked on Main Street 5 times because the lot was full every evening.',
  ],
  [
    'a street name and nights',
    'We stayed on Oak Road 3 nights and the traffic was calm the whole time.',
  ],
  [
    'a street name and a distance',
    'The hotel is on Beach Road 200 metres from the sea and the room was big.',
  ],
  [
    'a street name and a time',
    'Dinner on Station Road 7:30 sharp, the owner was kind and the food was great.',
  ],
  [
    'a room number overlooking the street',
    'Room 205 overlooking the street was quiet and the bed was big.',
  ],
  [
    'a count of lanes before a road',
    'It was a busy 2 lane road outside, but the windows kept the noise out.',
  ],
  ['a two way street', 'The hotel stands on a 2 way street with a bus stop at the door.'],
  ['one more street', 'Just 1 more street to cross and you are on the beach, easy.'],
  [
    'an article before a count and a place, in title case',
    'A 2 Bedroom Place With A Big Terrace And A Very Helpful Host.',
  ],
  [
    'an article before a count and a place, in capitals',
    'A 5 STAR PLACE WITH 3 POOLS AND 2 RESTAURANTS, HONESTLY THE BEST IN TOWN.',
  ],
  [
    'a rank in front of praise, title case',
    'Top 10 Best Place To Stay In Sofia, Honestly.',
  ],
  [
    'a rating category in front of praise, capitals',
    'LOCATION 10 AMAZING PLACE WITH A POOL AND A QUIET GARDEN.',
  ],
  [
    'a conjunction and a determiner in capitals',
    'WE GOT ROOM 12 AND THE WAY THE STAFF TREATED US WAS WARM AND KIND.',
  ],
  [
    'a preposition of place and a determiner in capitals',
    'ROOM 305 NEAR THE STREET WAS NOISY BUT THE BED WAS BIG.',
  ],
  [
    'an ordinal glued to its word in capitals',
    'THE 2ND FLOOR ROOM OVER THE ROAD WAS A BIT NOISY BUT FINE FOR 2 NIGHTS.',
  ],
  [
    'a comma after a number and praise',
    'Breakfast 7 To 10, Great Place For Families, The Staff Were Friendly.',
  ],
  [
    'a street name and 24/7',
    'The shop on Park Lane 24/7 was handy, the staff were kind and the room was quiet.',
  ],
]

describe('the wider address rules still leave ordinary prose alone', () => {
  it.each(STILL_PROSE)('%s', (_name, text) => {
    expect(redacted(text)).toBe(text)
  })
})

describe('the lists spelled out inside patterns agree with the profile lists', () => {
  function alternationAfter(source: string, anchor: string): readonly string[] {
    const start = source.indexOf(anchor) + anchor.length
    return source.slice(start, source.indexOf(')', start)).split('|')
  }

  it('spells out the number words of the spelled-out address pattern', () => {
    const source =
      ADDRESS_MARKER_PROFILE.patterns.find(
        (entry) => entry.id === 'address_spelled_first',
      )?.source ?? ''
    expect([...alternationAfter(source, "'’-])(")].sort()).toEqual(
      [...ADDRESS_MARKER_PROFILE.wordLists.numberWords].sort(),
    )
  })

  it('spells out the top-level domains of the split-domain pattern', () => {
    const source =
      NETWORK_MARKER_PROFILE.patterns.find((entry) => entry.id === 'split_domain')
        ?.source ?? ''
    expect([...alternationAfter(source, '[ \\t]+\\.(')].sort()).toEqual(
      [...NETWORK_MARKER_PROFILE.splitDomainTopLevels].sort(),
    )
  })
})
