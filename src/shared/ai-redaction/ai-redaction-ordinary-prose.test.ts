import { describe, expect, it } from 'vitest'
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
import { NETWORK_MARKER_PROFILE } from './ai-network-markers'
import { canonicalizeRawAiReviewSource } from '../ai-review-source/ai-review-source-contract'
import { inShortReview, redact, redacted } from './ai-redaction.test-fixtures'

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
    expect(redacted(inShortReview(text))).toBe(
      inShortReview(text).replace(pair, '[ADDRESS]'),
    )
  })

  it('leaves a longer dotted number alone', () => {
    const text = inShortReview('Build 42.6977, 23.3219.5 shipped on Friday.')
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
    const wrapped = inShortReview(text)
    expect(redacted(wrapped)).toBe(wrapped.replace(pair, '[ADDRESS]'))
  })

  it.each([
    ['one-decimal ratings', 'Rated 4.5, 3.8 and 4.2 by our family, a quiet place.'],
    ['two-decimal prices', 'Prices were 12.50, 14.75 and 9.99 for the three menus.'],
    ['a version number', 'The kiosk ran version 1.2.3 and then 2.4.5 after the update.'],
  ])('leaves %s alone', (_name, text) => {
    const wrapped = inShortReview(text)
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
    const wrapped = inShortReview(text)
    const out = redacted(wrapped)
    expect(out).not.toContain(address.replace(/^\[|\]:\d+$/gu, ''))
    expect(out).toContain('[CONTACT]')
  })

  it('leaves a version-like number with fewer than four parts alone', () => {
    const wrapped = inShortReview(
      'The kiosk ran version 1.2.3 and the Wi-Fi 6.5 was fast.',
    )
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
