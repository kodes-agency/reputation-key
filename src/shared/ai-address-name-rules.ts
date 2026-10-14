// The rules that tell a street's name from a clause of a review.
//
// `ai-address-markers.ts` finds the shapes (`12 Oak Road`, `Main Street 25`,
// `8 Place de la Concorde`) with patterns; this module decides, from the words
// between the house number and the street-type word, whether they read as a
// street's name or as prose (`2 weeks here and it was a wonderful place`).
//
// - A name that holds a word no street is named after (`was`, `to`, `nights`),
//   or follows an article (`a 5 Star Place`), is a clause, in any case.
// - A capitalised name (`Mile End`, `Love`, `Golf Course`, `All Saints`) is
//   otherwise a street: capital letters are the evidence, and an address sent to
//   the provider costs more than a few words of praise replaced.
// - A name typed in lower case is a street only when it holds none of the words
//   that are also everyday English (`down`, `this`, `star`, `great`) and, before
//   the street words that are everyday words themselves (`lane`, `drive`, `way`,
//   `court`, `place`), no counted unit and no praise.

import {
  ABBREVIATIONS,
  CLAUSE_TYPES,
  CONNECTORS,
  DETERMINERS,
  EVALUATIVE_TYPES,
  EVALUATIVES,
  LONE_NAMES,
  NAME_CONNECTOR_WORDS,
  PLACE_PREPOSITIONS,
  QUANTITIES,
  SOFT_UNITS,
  STRONG_GLUE,
  TIME_UNITS,
  UNIT_TYPES,
  WEAK_GLUE,
} from './ai-address-words'

const MAX_PLAIN_NAME_WORDS = 6

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

/** Whether the number reads as a rating (`10/10`, `Top 10`) or as a count (`a 5`). */
export type NumberLead = Readonly<{ rating: boolean; count: boolean }>

export const NO_LEAD: NumberLead = { rating: false, count: false }

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
 * before a street word that is rarely anything else: `10 the avenue`.
 */
function hasNoContentWord(shape: NameShape, bare: readonly string[]): boolean {
  if (bare.some((word) => !CONNECTORS.has(word))) return false
  const lone = bare.length === 1 && bare[0] === 'the'
  return !(lone && !CLAUSE_TYPES.has(shape.type.toLowerCase()))
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

/** A name typed in lower case (or in a mix): judged by its words. */
function plainNameRejected(shape: NameShape, bare: readonly string[]): boolean {
  return (
    bare.length > MAX_PLAIN_NAME_WORDS ||
    hasNoContentWord(shape, bare) ||
    connectorMisplaced(bare) ||
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

/**
 * Words no street's name contains, and the pronoun `I`: `305 I loved the place`.
 * A last `I` is a Roman numeral (`Knyaz Boris I Street`, `I Street`).
 */
function sentenceWordRejected(bare: readonly string[]): boolean {
  return bare.some(
    (word, index) =>
      TIME_UNITS.has(word) ||
      (STRONG_GLUE.has(word) && !(word === 'i' && index === bare.length - 1)),
  )
}

/** Whether the words between the number and the street-type word read as prose. */
export function rejectsName(shape: NameShape): boolean {
  const bare = shape.words.map(bareOf)
  if (shape.words.some(endsSentence)) return true
  if (QUANTITIES.has(bare[0] ?? '') || sentenceWordRejected(bare)) return true
  if (shape.lead.count) return true
  if (shape.named)
    return clausePhraseRejected(shape, bare) || praiseOfPlaceRejected(shape, bare)
  return plainNameRejected(shape, bare)
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
})
