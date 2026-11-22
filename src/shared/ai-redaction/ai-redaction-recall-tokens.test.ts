import { describe, expect, it } from 'vitest'
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
import { BASE_STREET_TYPE_WORDS, EXTRA_STREET_TYPE_WORDS } from './ai-address-words'
import {
  describeInFrames,
  inShortReview,
  redacted,
  redactedRaw,
  replacing,
  type Shape,
} from './ai-redaction.test-fixtures'

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

describeInFrames('an IP address in a rarer layout in %s', IP_FORMS, '[CONTACT]')

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
