import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
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
    'a street written before its number',
    'We met at Main Street 25 near the station.',
    'US',
  ],
  ['a Bulgarian street word', 'Адресът е ул. Витоша 25, София, до метростанцията.', 'BG'],
  [
    'a street-first layout typed in lower case',
    'We live at 100 boulevard haussmann now.',
    'US',
  ],
  [
    'a street word with no English type word',
    'We stayed at 16 rue de rivoli last week.',
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
