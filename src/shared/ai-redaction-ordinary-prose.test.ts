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
