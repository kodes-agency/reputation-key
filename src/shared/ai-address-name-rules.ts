// The rules that tell a street's name from a clause of a review.
//
// `ai-address-markers.ts` finds the shapes (`12 Oak Road`, `Main Street 25`,
// `8 Place de la Concorde`) with patterns; this module decides, from the words
// between the house number and the street-type word and from the word in front
// of the number, whether they read as a street's name or as prose (`2 weeks
// here and it was a wonderful place`).
//
// - A name that holds a word no street is named after (`was`, `to`), a sentence
//   stop, or a counted unit that a clause can carry, is a clause of the review.
// - A capitalised name (`Mile End`, `Love`, `Golf Course`, `All Saints`, `Miles`,
//   `Weeks Mill`, `Henley on Thames`) is otherwise a street: capital letters are
//   the evidence, and an address sent to the provider costs more than a few
//   words of praise replaced. A counted unit in a capitalised name rules it out
//   only before a street word that is an everyday word (`2 Minutes Drive`) or
//   when a word of place or time follows it (`5 Nights Near Main Street`).
// - A name typed in lower case is a street only when it holds none of the words
//   that are also everyday English (`down`, `this`, `star`, `great`) and, before
//   the street words that are everyday words themselves (`lane`, `drive`, `way`,
//   `court`, `place`), no counted unit and no praise. After a word that
//   introduces an address (`at`, `to`, `from`, `address`) those everyday words
//   are a street's name (`We stayed at 12 love place`): what no street is named
//   after (function words, spans of time) still rules the name out.
// - A number after an article or a possessive (`a`, `the`, `our`) is a count only
//   when the name carries one (`a 5 Star Place`, `a 2 Bedroom Place`); `Flat A 12
//   Oak Road` and `the 5 Park Lane` are addresses.

import {
  ABBREVIATIONS,
  ADDRESS_LABELS,
  ADDRESS_LEADS,
  COUNT_LEADS,
  RATING_LEADS,
  CLAUSE_TYPES,
  CONNECTORS,
  DETERMINERS,
  EVALUATIVE_TYPES,
  EVALUATIVES,
  LONE_NAMES,
  NAME_CONNECTOR_WORDS,
  NAME_PREPOSITIONS,
  PLACE_PREPOSITIONS,
  QUANTITIES,
  SOFT_UNITS,
  STRONG_GLUE,
  TIME_UNITS,
  UNIT_TYPES,
  WEAK_GLUE,
} from './ai-address-words'

const MAX_PLAIN_NAME_WORDS = 6
/** After `at`, a name of more words than this is read as a sentence, not as a street. */
const MAX_ADDRESS_LEAD_NAME_WORDS = 3

/** A capitalised word, an abbreviation like `St.` or `Jr.`, or an ordinal. */
const NAME_WORD_RE =
  /^(?:\p{Lu}[\p{L}\p{M}'’-]*|\p{Lu}[\p{L}\p{M}]{0,2}\.|\d{1,3}(?:st|nd|rd|th|ST|ND|RD|TH))$/u
export const LOWER_NAME_WORD_RE = /^\p{Ll}[\p{L}\p{M}'’-]*$/u

export const OPEN_STREET_TYPES: ReadonlySet<string> = new Set([
  'avenue',
  'ave',
  'boulevard',
  'blvd',
  'street',
  'st',
  'road',
  'rd',
])
export const PLAIN_CONNECTORS: ReadonlySet<string> = new Set(['and', 'of', 'the'])
export const FOREIGN_CONNECTORS: ReadonlySet<string> = new Set(
  NAME_CONNECTOR_WORDS.filter((word) => !PLAIN_CONNECTORS.has(word)),
)

export type NameShape = Readonly<{
  /** The name words as typed, in order. */
  words: readonly string[]
  /** The street-type word as typed. */
  type: string
  /** The name is written the way a proper street name is: in capitals. */
  named: boolean
  /** What stands in front of the house number. */
  lead: NumberLead
  /** The number is in front of the name: `12 Oak Road`, not `Avenue of the Americas`. */
  numberFirst: boolean
}>

/**
 * What stands in front of the house number: a rating (`10/10`, `Top 10`), a
 * count (`a 5`), or a word that introduces an address (`at 12`, `address is 12`).
 */
export type NumberLead = Readonly<{
  rating: boolean
  count: boolean
  address: boolean
}>

export const NO_LEAD: NumberLead = { rating: false, count: false, address: false }

/** The word in front of a number. */
const WORD_BEFORE_RE = /([\p{L}.]+)[ \t]*[:=–-]?[ \t]*$/u
const LEAD_LOOKBEHIND_SCALARS = 48
const ADDRESS_LABEL_REACH = 3

/** The words just before `start`, nearest last, at most `count` of them. */
function wordsBefore(text: string, start: number, count: number): readonly string[] {
  const window = text.slice(Math.max(0, start - LEAD_LOOKBEHIND_SCALARS), start)
  return (window.match(/[\p{L}.]+/gu) ?? [])
    .slice(-count)
    .map((word) => word.toLowerCase())
}

/** What stands in front of the number at `start`: `10/10`, `Top 10`, `a 5`, `at 12`. */
export function leadOf(text: string, start: number): NumberLead {
  if (start < 0) return NO_LEAD
  if (text[start - 1] === '/') return { rating: true, count: false, address: false }
  const found = WORD_BEFORE_RE.exec(text.slice(Math.max(0, start - 16), start))
  const word = (found?.[1] ?? '').toLowerCase()
  return {
    rating: RATING_LEADS.has(word),
    count: COUNT_LEADS.has(word),
    address:
      ADDRESS_LEADS.has(word) ||
      wordsBefore(text, start, ADDRESS_LABEL_REACH).some((label) =>
        ADDRESS_LABELS.has(label),
      ),
  }
}

function bareOf(word: string): string {
  return word.toLowerCase().replace(/\.$/u, '')
}

function isAbbreviation(word: string): boolean {
  if (!word.endsWith('.')) return false
  const bare = bareOf(word)
  return NAME_WORD_RE.test(word) || bare.length === 1 || ABBREVIATIONS.has(bare)
}

/** A word that ends in a full stop and is not an abbreviation ends a sentence. */
export function endsSentence(word: string): boolean {
  return word.endsWith('.') && !isAbbreviation(word)
}

export function isNameWord(word: string): boolean {
  return NAME_WORD_RE.test(word)
}

/**
 * Capitalised words, with lower-case connectors between or before them, that
 * end on a capitalised word: how a proper street name is written.
 */
function isNamedRun(words: readonly string[]): boolean {
  const last = words.at(-1)
  return (
    last !== undefined &&
    isNameWord(last) &&
    words.every((word) => isNameWord(word) || CONNECTORS.has(word))
  )
}

/**
 * A name of nothing but particles is no name (`10 the place`), except `the`
 * before a street word that is rarely anything else (`10 the avenue`) and after
 * a word that introduces an address (`at 12 the drive`, a street in many towns).
 */
function hasNoContentWord(shape: NameShape, bare: readonly string[]): boolean {
  if (bare.some((word) => !CONNECTORS.has(word))) return false
  const lone = bare.length === 1 && bare[0] === 'the'
  const clauseType = CLAUSE_TYPES.has(shape.type.toLowerCase())
  return !(lone && (shape.lead.address || !clauseType))
}

/**
 * Words that make a lower-case name too much like a sentence: `2 doors down the
 * road`. A lone `down` or `our` before a street word that is rarely anything
 * else is a name (`12 down street`).
 */
function weakGlueRejected(shape: NameShape, bare: readonly string[]): boolean {
  if (!bare.some((word) => WEAK_GLUE.has(word))) return false
  const lone =
    bare.length === 1 &&
    LONE_NAMES.has(bare[0] ?? '') &&
    !CLAUSE_TYPES.has(shape.type.toLowerCase())
  return !lone
}

/** Counts before a drive or a place, praise before a place: `a 3 day drive`. */
function everydayTypeRejected(shape: NameShape, bare: readonly string[]): boolean {
  const type = shape.type.toLowerCase()
  return (
    (UNIT_TYPES.has(type) && bare.some((word) => SOFT_UNITS.has(word))) ||
    (EVALUATIVE_TYPES.has(type) && bare.some((word) => EVALUATIVES.has(word)))
  )
}

/**
 * A particle is part of a name only between its words (`saint john of god`,
 * `top of the hill`), or first when it is `the` or a particle of another
 * language (`the old mill`, `de la rosa`). `overlooking the street` ends in one.
 */
function connectorMisplaced(bare: readonly string[]): boolean {
  return bare.some((word, index) => {
    if (!CONNECTORS.has(word)) return false
    if (index === 0) return !(word === 'the' || FOREIGN_CONNECTORS.has(word))
    return index === bare.length - 1
  })
}

/**
 * Words no street is named after: the glue of a sentence (`was`, `to`, `we`),
 * and the pronoun `I` (`305 I loved the place`; a last `I` is a Roman numeral,
 * `Knyaz Boris I Street`). A preposition between two words of a name is a
 * place's own (`Henley on Thames`) when the name is a proper one or follows a
 * word that introduces an address.
 */
function sentenceWordRejected(
  bare: readonly string[],
  prepositionsAllowed: boolean,
): boolean {
  return bare.some((word, index) => {
    if (!STRONG_GLUE.has(word)) return false
    if (word === 'i') return index !== bare.length - 1
    const between = index > 0 && index < bare.length - 1
    return !(prepositionsAllowed && between && NAME_PREPOSITIONS.has(word))
  })
}

/** A span of time in the name: no lower-case street is named after one. */
function timeUnitRejected(bare: readonly string[]): boolean {
  return bare.some((word) => TIME_UNITS.has(word))
}

/** A name typed in lower case (or in a mix): judged by its words. */
function plainNameRejected(shape: NameShape, bare: readonly string[]): boolean {
  const atAddress = shape.lead.address
  if (
    bare.length > MAX_PLAIN_NAME_WORDS ||
    hasNoContentWord(shape, bare) ||
    connectorMisplaced(bare) ||
    timeUnitRejected(bare) ||
    sentenceWordRejected(bare, atAddress)
  ) {
    return true
  }
  if (atAddress && bare.length <= MAX_ADDRESS_LEAD_NAME_WORDS) return false
  return (
    bare.some((word) => QUANTITIES.has(word)) ||
    weakGlueRejected(shape, bare) ||
    everydayTypeRejected(shape, bare)
  )
}

/**
 * `NEAR THE STREET`, `ALONG THE ROAD`, `ROOM 12 AND THE WAY`, `3 OF THE GUIDE`:
 * a clause in capitals. A proper name has `Fox and Hounds` or `Top of the Hill`,
 * but not a conjunction followed by a determiner, and none opens with a particle
 * such as `of`.
 */
function clausePhraseRejected(shape: NameShape, bare: readonly string[]): boolean {
  if (PLACE_PREPOSITIONS.has(bare[0] ?? '') && DETERMINERS.has(bare[1] ?? '')) return true
  if (shape.numberFirst && bare.length > 1 && (bare[0] === 'of' || bare[0] === 'and')) {
    return true
  }
  return bare.some(
    (word, index) => word === 'and' && DETERMINERS.has(bare[index + 1] ?? ''),
  )
}

/** `10/10 GREAT PLACE`, `Ten Great Place`: praise with a rating in front. */
function praiseOfPlaceRejected(shape: NameShape, bare: readonly string[]): boolean {
  const type = shape.type.toLowerCase()
  return (
    shape.lead.rating &&
    EVALUATIVE_TYPES.has(type) &&
    bare.some((word) => EVALUATIVES.has(word))
  )
}

function isCounted(word: string): boolean {
  return QUANTITIES.has(word) || TIME_UNITS.has(word)
}

/**
 * A counted unit in a capitalised name is a street's own (`12 Miles Avenue`,
 * `40 Weeks Street`, `34 Weeks Mill Drive`) unless the name is a title-case
 * clause: before a drive, a way or a place (`2 Minutes Drive`) that no address
 * introduces, or with a word of place or time after the unit (`5 Nights Near
 * Main Street`, `3 Weeks In`).
 */
function namedUnitRejected(shape: NameShape, bare: readonly string[]): boolean {
  const everyday = CLAUSE_TYPES.has(shape.type.toLowerCase()) && !shape.lead.address
  if (everyday && (QUANTITIES.has(bare[0] ?? '') || timeUnitRejected(bare))) return true
  return bare.some((word, index) => {
    const next = bare[index + 1] ?? ''
    return isCounted(word) && (PLACE_PREPOSITIONS.has(next) || STRONG_GLUE.has(next))
  })
}

function namedRejected(shape: NameShape, bare: readonly string[]): boolean {
  // After `at`, a short name written with capitals is the address, whatever its words.
  const introduced = shape.lead.address && bare.length <= MAX_ADDRESS_LEAD_NAME_WORDS
  return (
    clausePhraseRejected(shape, bare) ||
    praiseOfPlaceRejected(shape, bare) ||
    namedUnitRejected(shape, bare) ||
    (!introduced && sentenceWordRejected(bare, true))
  )
}

/**
 * Whether a name carries what a count needs: a unit, a span of time, praise. A
 * number after an article is a house number when it has none (`Flat A 12 Oak
 * Road`, `the 5 Park Lane`), a count when it has one (`a 5 Star Place`).
 */
function carriesCount(bare: readonly string[]): boolean {
  return bare.some(
    (word) => isCounted(word) || SOFT_UNITS.has(word) || EVALUATIVES.has(word),
  )
}

/**
 * Whether a word of the name is an everyday word: a unit, a span of time, praise
 * or glue. A number written out is a house number only before a name without
 * one (`Twelve Oak Road`, not `Five Star Place` or `One Way Street`).
 */
export function hasEverydayWord(words: readonly string[]): boolean {
  return words
    .map(bareOf)
    .some(
      (word) =>
        isCounted(word) ||
        SOFT_UNITS.has(word) ||
        EVALUATIVES.has(word) ||
        WEAK_GLUE.has(word) ||
        STRONG_GLUE.has(word),
    )
}

/** Whether the words between the number and the street-type word read as prose. */
export function rejectsName(shape: NameShape): boolean {
  const bare = shape.words.map(bareOf)
  if (shape.words.some(endsSentence)) return true
  if (shape.lead.count && carriesCount(bare)) return true
  return shape.named ? namedRejected(shape, bare) : plainNameRejected(shape, bare)
}

export function shapeOf(
  words: readonly string[],
  type: string,
  lead: NumberLead,
): NameShape {
  return { words, type, named: isNamedRun(words), lead, numberFirst: true }
}

/** What the detector profile digest records about the name rules. */
export const ADDRESS_NAME_RULE_PROFILE = Object.freeze({
  patterns: Object.freeze([
    Object.freeze({
      id: 'address_name_word',
      source: NAME_WORD_RE.source,
      flags: NAME_WORD_RE.flags,
    }),
    Object.freeze({
      id: 'address_lower_name_word',
      source: LOWER_NAME_WORD_RE.source,
      flags: LOWER_NAME_WORD_RE.flags,
    }),
  ]),
  openStreetTypes: Object.freeze([...OPEN_STREET_TYPES].sort()),
  plainConnectors: Object.freeze([...PLAIN_CONNECTORS].sort()),
  maxPlainNameWords: MAX_PLAIN_NAME_WORDS,
  maxAddressLeadNameWords: MAX_ADDRESS_LEAD_NAME_WORDS,
  leadLookbehindScalars: LEAD_LOOKBEHIND_SCALARS,
  addressLabelReach: ADDRESS_LABEL_REACH,
  namePrepositions: Object.freeze([...NAME_PREPOSITIONS].sort()),
})
