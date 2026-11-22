import { describe, expect, it } from 'vitest'
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
import { inShortReview, redact, redacted, words } from './ai-redaction.test-fixtures'

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
    const text = inShortReview(clause)
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
        const text = inShortReview(`We dined at ${address} on Friday.`)
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
    'a street of another language with no type word and no label',
    'We stayed at Karlova 12 last week.',
    'US',
  ],
  [
    'a lower-case name with an everyday word and nothing that introduces the address',
    'If you come by car, 7 wonderful place is right by the church.',
    'US',
  ],
  [
    'a lower-case name that is a function word',
    'We stayed at 12 not road last month.',
    'US',
  ],
  [
    'a lower-case name that is a plural span of time',
    'We stayed at 12 weeks place last month.',
    'US',
  ],
]

describe('redaction does not take these address shapes (known gaps)', () => {
  it.each(NOT_DETECTED_ADDRESSES)('%s', (_name, text, countryCode) => {
    expect(redacted(inShortReview(text), countryCode)).toBe(inShortReview(text))
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
  ['in a short review', inShortReview],
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

const ORDINARY_STREET_NAMES = words(
  `Main, Church, High, Park, Oak, Pine, Maple, Cedar, Elm, Washington, Lake, Hill, Second, Walnut, Sunset, Highland, Mill, Station, Victoria, King, Green, Spring, North, Chestnut, Willow, Lincoln, River, Ridge, Meadow, Cherry, School, Market, Bridge, New, Old, Manor, Orchard, Garden, Rose, Oxford, Cambridge, Broad, Long, Beach, Harbour, Castle, Abbey, Vine, Brook, Valley, Ocean, Union, Liberty, O'Connell, De La Rosa`,
)
/** Real street names that read like everyday words, none holding a glue word. */
const EVERYDAY_STREET_NAMES = words(
  `Love, Hope, Good, Great, Pleasant, Quiet, Central, Best, Kind, Friendly, Clean, Mile, Mile End, Star, Pound, Day, Time, Week, Year, Night, Bed, Room, Step, Guest, Block, Course, Golf Course, Floor, Down, Up, Over, Under, Out, Off, Near, Past, After, Before, The Old Mill, The Green, The, Of, Our, My, Your, Their, This, That, Lane Cove, Way, All Saints, Every, Each, More, Only, Per, Same, Other, Under Hill, Hill Top, Top, Perfect, Worth, Super, Super Cheap, Nice, Charming, Beautiful, Modern`,
)
const STREET_TYPES = words(
  `Street, St, Road, Rd, Avenue, Ave, Boulevard, Blvd, Lane, Ln, Drive, Dr, Way, Court, Ct, Place, Pl`,
)
const OPEN_STREET_TYPES = words(`Street, St, Road, Rd, Avenue, Ave, Boulevard, Blvd`)
const HOUSE_NUMBERS = ['12', '7', '221', '1400']
/**
 * Everyday-word names that hold a glue word (`all`, `under`, `more`, `lane`), or
 * are one. Typed in lower case they read as a clause (`1 more street`, `a 2 lane
 * road`) and are left alone; capitalised they are streets. Pinned below.
 */
const LOWER_CASE_GLUE_NAMES: ReadonlySet<string> = new Set(
  words(
    `Of, Lane Cove, Way, All Saints, Every, Each, More, Only, Per, Same, Other, Under Hill`,
  ),
)

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
        const text = inShortReview(`We stayed at ${address} last month.`)
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
