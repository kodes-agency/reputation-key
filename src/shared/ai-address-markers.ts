// Street-address markers of structured-marker-detectors-v1.
//
// An address is a house number, the street's name and a street-type word
// (`25 Main Street`). The first version of this detector took a number, up to
// eight arbitrary words and a word like `place`, `way` or `drive`, so it also
// took `2 weeks here and it was a wonderful place` and `a 10 minute drive`:
// whole clauses of ordinary prose became [ADDRESS], and a short review that
// was mostly such a clause was refused outright. The second version stopped
// that and let real addresses through: streets named `Love Lane` or `Mile End
// Road`, lower-case `12 the old mill road`, `Main Street 25`. This version
// keeps both: it finds the shapes loosely with a pattern and decides in code,
// where case and the words themselves are the evidence.
//
// LAYOUTS. Five shapes are read. Each ends in an optional postal tail (a city,
// a state, a postcode on the same line).
//
// - NAME FIRST: the house number, one to six name words, a street-type word
//   (`25 Main Street`, `7 oak lane`, `12 de la Rosa Street`, `12, Oak Road`,
//   `12Oak Road`). A number written out (`Twelve Oak Road`) counts when the
//   name is capitalised.
// - STREET FIRST: the number, a street-type word, the name (`100 Boulevard
//   Saint-Germain`, `8 Place de la Concorde`, `100 boulevard haussmann`), or
//   the street-type word, the name and the number (`Pl. de Catalunya 5`).
// - NUMBER LAST (`ai-address-number-last.ts`): the name and the street-type
//   word, then the number (`Main Street 25`, `Baker Street 221B`, `Oak Road
//   (no. 12)`).
// - OTHER LANGUAGES, own-type streets and the address after a label
//   (`ai-foreign-address-markers.ts`): `12 rue de la Paix`, `Hauptstraße 12`,
//   `50 Broadway`, `Address: Karlova 12`.
// - BULGARIAN: `ул.`, `бул.` or `пл.`, the name and the number, with a
//   district before it (`ж.к. Лозенец, ул. Златоврах 5`).
//
// WHAT RULES A NAME OUT (`rejectsName`). A name that holds a word no street is
// named after (`was`, `to`, `nights`) is a clause of a review, in any case. A
// capitalised name (`Mile End`, `Love`, `Golf Course`, `All Saints`) is
// otherwise a street: capital letters are the evidence, and an address sent to
// the provider costs more than a few words of praise replaced. A name typed in
// lower case is a street only when it holds none of the words that are also
// everyday English (`down`, `this`, `star`, `great`) and, before the street
// words that are everyday words themselves (`lane`, `drive`, `way`, `court`,
// `place`), no counted unit and no praise.
//
// Not detected: a street first typed in lower case with `place` and no particle
// (`10 place to stay`, which is prose), a street of another language with no
// type word and no label (`Karlova 12`), and a lower-case name that holds an
// everyday word when nothing introduces the address (`7 wonderful place`).

import {
  ADDRESS_LABEL_WORDS,
  ADDRESS_LEAD_WORDS,
  CONNECTORS,
  EVALUATIVE_WORDS,
  CLAUSE_STREET_TYPES,
  COUNT_LEAD_WORDS,
  DETERMINER_WORDS,
  COUNT_FOLLOWER_WORDS,
  EXTRA_STREET_TYPES,
  EXTRA_STREET_TYPE_WORDS,
  GENERIC_NAME_WORDS,
  EVALUATIVE_STREET_TYPES,
  LONE_NAME_WORDS,
  UNIT_STREET_TYPES,
  LOWER_CASE_ABBREVIATIONS,
  NAME_CONNECTOR_WORDS,
  NAME_PREPOSITION_WORDS,
  NUMBER_WORDS,
  PLACE_PREPOSITION_WORDS,
  QUANTITIES,
  QUANTITY_WORDS,
  RATING_LEAD_WORDS,
  SOFT_UNIT_WORDS,
  STRONG_GLUE,
  STRONG_GLUE_WORDS,
  TIME_UNIT_WORDS,
  WEAK_GLUE,
  WEAK_GLUE_WORDS,
} from './ai-address-words'
import {
  ADDRESS_NAME_RULE_PROFILE,
  FOREIGN_CONNECTORS,
  hasEverydayWord,
  leadOf,
  LOWER_NAME_WORD_RE,
  OPEN_STREET_TYPES,
  PLAIN_CONNECTORS,
  endsSentence,
  isNameWord,
  rejectsName,
  shapeOf,
  type NameShape,
} from './ai-address-name-rules'
import {
  findForeignAddressMarkers,
  FOREIGN_ADDRESS_PROFILE,
} from './ai-foreign-address-markers'
import { findNumberLast, NUMBER_LAST_PROFILE } from './ai-address-number-last'
import {
  NUMBER_FOLLOWER_LOOKAHEAD_SCALARS,
  endsClause,
  POSTAL_TAIL_RE,
  WORD_AFTER_RE,
  followedByQuantity,
  tokensOf,
  withPostalTail,
  wordsOf,
  type AddressMarkerSpan,
  type Token,
} from './ai-address-spans'

export type { AddressMarkerSpan }

const MAX_STREET_FIRST_NAME_WORDS = 4
const NUMBER_FIRST_LOOKBEHIND_SCALARS = 24

/*
 * Candidate repetitions are bounded ({1,6}, {1,5}, {0,3}) and every repeated unit
 * ends in a mandatory blank or starts with a letter case that no connector
 * shares, so none can overlap the next; patterns that start at no anchor start
 * after a letter-class lookbehind; the input is capped at 65,536 scalars before
 * any pattern runs. The security rule cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/**
 * Name first: a house number (not part of a longer numeral, not a price), a
 * blank, a comma, a dash or nothing, one to six words (or ordinals like `5th`; a
 * word may end in a full stop), any street-type word. Case-insensitive; the
 * shape of the words is judged in code, so this only finds the candidates.
 */
const NAME_FIRST_RE =
  /(?<!\p{N}[.,:])(?<![$€£])(?<![\p{L}\p{N}])(\d{1,8}(?:[A-Za-z](?!\p{L}))?)([ \t]+|[ \t]*[,;–-][ \t]*|(?=\p{L}))((?:(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*(?:\.[\p{L}\p{M}][\p{L}\p{M}'’-]*)*\.?)[ \t]+){1,8})(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|close|crescent|cres|gardens|gdns|square|sq|parkway|pkwy|terrace|ter|grove|circle|cir|walk|trail|loop|highway|hwy|mews|approach|alley|plaza|row)(?![\p{L}\p{M}\p{N}])/giu
/**
 * A number written out, one to five name words, a street-type word. The number
 * words are spelled out here because a pattern that took any first word would
 * start at the wrong one; a test holds the list to `NUMBER_WORDS`.
 */
const SPELLED_FIRST_RE =
  /(?<![\p{L}\p{M}'’-])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)[ \t]+((?:(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?)[ \t]+){1,5})(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)(?![\p{L}\p{M}\p{N}])/giu
/**
 * The same two layouts read again after a shorter reading is wanted. They are
 * anchored at the text right after the house number (or the spelled number),
 * so a window that stops before a street-type word already read finds the
 * address inside it: `12 Oak Road. It was a great place` is read first up to
 * `place`, as a clause, and then up to `Road`, as the address it holds.
 */
const NAME_FIRST_REREAD_RE =
  /^([ \t]+|[ \t]*[,;–-][ \t]*|(?=\p{L}))((?:(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*(?:\.[\p{L}\p{M}][\p{L}\p{M}'’-]*)*\.?)[ \t]+){1,8})(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|close|crescent|cres|gardens|gdns|square|sq|parkway|pkwy|terrace|ter|grove|circle|cir|walk|trail|loop|highway|hwy|mews|approach|alley|plaza|row)(?![\p{L}\p{M}\p{N}])/iu
const SPELLED_FIRST_REREAD_RE =
  /^([ \t]+)((?:(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?)[ \t]+){1,5})(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)(?![\p{L}\p{M}\p{N}])/iu
/** Street first: the street-type word, then up to five words of its name. */
const STREET_FIRST_RE =
  /(?<![\p{L}\p{M}])(avenue|ave|boulevard|blvd|place|pl)\b\.?((?:[ \t]+(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?)){1,5})/giu
/** The house number in front of a word: digits, a letter, blanks. */
const NUMBER_BEFORE_RE = /(\d{1,8}(?:[A-Za-z](?!\p{L}))?)[ \t]+$/u
/** The house number after a street's name, and what may sit between. */
const NUMBER_AFTER_RE =
  /[ \t]*[,;]?[ \t]*(?:(?:no|nr|№|#)\.?[ \t]*)?(\d{1,5}[A-Ea-e]?)(?![\p{L}\p{N}/:%]|\.\d)/iuy
/**
 * Bulgarian: an optional district (`ж.к. Лозенец,`), `ул.`, `бул.` or `пл.` (or
 * the Latin `ul.` and `bul.`), the name (quoted or up to four words) and the number.
 */
const BULGARIAN_STREET_RE =
  /(?<![\p{L}\p{M}])((?:(?:ж\.?[ \t]?к\.?|жк)[ \t]+[\p{L}\p{M}-]+(?:[ \t]+[\p{L}\p{M}-]+)?[ \t]*,?[ \t]*)?)(?:(?:ул|бул|пл|улица|булевард|площад)(?![\p{L}\p{M}])\.?|(?:ul|bul)\.)[ \t]*([„"«][^„“"»«\r\n]{1,60}[“"»]|(?:[\p{L}\p{M}'’-]+\.?[ \t]+){0,3}[\p{L}\p{M}'’-]+)[ \t]*[,;]?[ \t]*(?:(?:№|N|No|#)[ \t]*)?(\d{1,4}\p{L}?)(?![\p{L}\p{N}/:%]|\.\d)/giu
/* eslint-enable security/detect-unsafe-regex */

/**
 * Words after a Bulgarian house number that make it a quantity (`2 нощувки`) or
 * the start of a prose clause (`3 без захар`, `10 от 10`).
 */
const BULGARIAN_QUANTITIES: ReadonlySet<string> = new Set([
  'без',
  'дни',
  'дена',
  'евро',
  'звезди',
  'км',
  'лв',
  'лева',
  'мин',
  'минути',
  'нощи',
  'нощувки',
  'от',
  'пъти',
  'часа',
  'часове',
])

function isPlainBlank(separator: string): boolean {
  return /^[ \t]+$/u.test(separator)
}

/**
 * A comma, a dash or nothing after the house number (`12, Oak Road`, `12 - Oak
 * Road`, `12Oak Road`) is an address only for a proper name before a street word
 * that is rarely anything else: `7 To 10, Great Place` and `4TH FLOOR` are not.
 */
function separatorAccepted(separator: string, run: string, shape: NameShape): boolean {
  if (isPlainBlank(separator)) return true
  if (!shape.named || !OPEN_STREET_TYPES.has(shape.type.toLowerCase())) return false
  return separator !== '' || /^\p{Lu}\p{Ll}/u.test(run)
}

/** How the words after a house number read: where the name ends and the type begins. */
type Reading = Readonly<{
  whole: string
  separator: string
  run: string
  type: string
}>

/**
 * The reading the pattern took, and every shorter one: the pattern takes the
 * longest run of words that ends in a street-type word, so a real address
 * followed by a sentence that holds another street-type word (`12 Oak Road. It
 * was a great place`) is first read as one clause. Each shorter reading ends at
 * an earlier street-type word, longest first.
 */
function readingsOf(
  text: string,
  start: number,
  numberText: string,
  first: Reading,
  reread: RegExp,
): readonly Reading[] {
  const readings: Reading[] = [first]
  const bodyStart = start + numberText.length
  let typeStart = start + first.whole.length - first.type.length
  for (;;) {
    const found = reread.exec(text.slice(bodyStart, typeStart))
    if (found === null) return readings
    const [body = '', separator = '', run = '', type = ''] = found
    readings.push({ whole: numberText + body, separator, run, type })
    typeStart = bodyStart + body.length - type.length
  }
}

/**
 * A street type that is also an everyday word (`close`, `walk`, `row`) ends a
 * street only when it is written the way a proper name is: the type and every
 * word of the name capitalised.
 */
function extraTypeAccepted(type: string, shape: NameShape): boolean {
  if (!EXTRA_STREET_TYPES.has(type.toLowerCase())) return true
  return shape.named && /^\p{Lu}/u.test(type)
}

function findNameFirst(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(NAME_FIRST_RE)) {
    const [whole, number = '', separator = '', run = '', type = ''] = match
    const lead = leadOf(text, match.index)
    const readings = readingsOf(
      text,
      match.index,
      number,
      { whole, separator, run, type },
      NAME_FIRST_REREAD_RE,
    )
    const accepted = readings.find((reading) => {
      const shape = shapeOf(wordsOf(reading.run), reading.type, lead)
      return (
        extraTypeAccepted(reading.type, shape) &&
        separatorAccepted(reading.separator, reading.run, shape) &&
        !rejectsName(shape)
      )
    })
    if (accepted !== undefined) {
      spans.push(withPostalTail(text, match.index, match.index + accepted.whole.length))
    }
  }
  return spans
}

function findSpelledFirst(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(SPELLED_FIRST_RE)) {
    const [whole, numberWord = '', run = '', type = ''] = match
    if (!/^\p{Lu}/u.test(numberWord)) continue
    const lead = { ...leadOf(text, match.index), rating: true }
    const readings = readingsOf(
      text,
      match.index,
      numberWord,
      { whole, separator: ' ', run, type },
      SPELLED_FIRST_REREAD_RE,
    )
    const accepted = readings.find((reading) => {
      const shape = shapeOf(wordsOf(reading.run), reading.type, lead)
      return shape.named && !hasEverydayWord(shape.words) && !rejectsName(shape)
    })
    if (accepted !== undefined) {
      spans.push(withPostalTail(text, match.index, match.index + accepted.whole.length))
    }
  }
  return spans
}

/** Where the digits of a house number in front of `index` start, or -1. */
function numberBefore(text: string, index: number): number {
  const from = Math.max(0, index - NUMBER_FIRST_LOOKBEHIND_SCALARS)
  const found = NUMBER_BEFORE_RE.exec(text.slice(from, index))
  if (found === null) return -1
  const start = from + found.index
  const prior = text[start - 1]
  return prior !== undefined && /[\p{L}\p{N}.,:$€£]/u.test(prior) ? -1 : start
}

/** Where the house number after `index` ends, or -1. */
function numberAfter(text: string, index: number): number {
  NUMBER_AFTER_RE.lastIndex = index
  const found = NUMBER_AFTER_RE.exec(text)
  if (found === null) return -1
  const end = index + found[0].length
  return followedByQuantity(text, end) ? -1 : end
}

/** The word without the full stop that ends a sentence, and whether it did. */
function withoutSentenceStop(word: string): readonly [string, boolean] {
  return endsSentence(word) ? [word.slice(0, -1), true] : [word, false]
}

/** The leading name words of a street-first name: capitalised, particles allowed. */
function capitalisedPrefix(tokens: readonly Token[]): readonly Token[] {
  const kept: Token[] = []
  for (const token of tokens) {
    const [word, stops] = withoutSentenceStop(token.word)
    if (kept.length >= MAX_STREET_FIRST_NAME_WORDS) break
    if (!isNameWord(word) && !CONNECTORS.has(word)) break
    kept.push(token)
    if (stops) break
  }
  while (
    kept.length > 0 &&
    !isNameWord(withoutSentenceStop(kept.at(-1)?.word ?? '')[0])
  ) {
    kept.pop()
  }
  return kept
}

/** The leading name words of a lower-case street-first name. */
function lowerPrefix(tokens: readonly Token[]): readonly Token[] {
  const kept: Token[] = []
  for (const token of tokens) {
    const [word, stops] = withoutSentenceStop(token.word)
    const bare = word.toLowerCase()
    const glue = STRONG_GLUE.has(bare) || WEAK_GLUE.has(bare) || QUANTITIES.has(bare)
    if (kept.length >= MAX_STREET_FIRST_NAME_WORDS || !LOWER_NAME_WORD_RE.test(word))
      break
    if (glue && !CONNECTORS.has(bare)) break
    kept.push(token)
    if (stops) break
  }
  while (
    kept.length > 0 &&
    CONNECTORS.has(withoutSentenceStop(kept.at(-1)?.word ?? '')[0])
  ) {
    kept.pop()
  }
  return kept
}

/** A lower-case street first is an address when its type is open or it has a particle. */
function lowerStreetFirstAccepted(type: string, tokens: readonly Token[]): boolean {
  if (OPEN_STREET_TYPES.has(type)) return true
  return tokens.some((token) => FOREIGN_CONNECTORS.has(token.word))
}

/** Cuts a trailing full stop that ends a sentence off the last kept token. */
function trimmedEnd(token: Token): number {
  return endsSentence(token.word) ? token.end - 1 : token.end
}

/**
 * The name of a street-first address and whether it is written as a proper name.
 * A capitalised name follows a street-type word in any case (`5 avenue Victor
 * Hugo`); a lower-case one needs a street word that is rarely anything else or a
 * particle of another language (`100 boulevard haussmann`, `8 place de la
 * concorde`, but not `10 place to stay`).
 */
function streetFirstName(
  tokens: readonly Token[],
  type: string,
): Readonly<{ name: readonly Token[]; named: boolean }> {
  const capitalised = capitalisedPrefix(tokens)
  if (capitalised.length > 0) return { name: capitalised, named: true }
  const lower = lowerPrefix(tokens)
  return { name: lowerStreetFirstAccepted(type, lower) ? lower : [], named: false }
}

/** The name read at each length, longest first, never ending on a particle. */
function streetFirstReadings(name: readonly Token[]): readonly (readonly Token[])[] {
  const readings: (readonly Token[])[] = []
  for (let length = name.length; length >= 1; length -= 1) {
    const reading = name.slice(0, length)
    const last = withoutSentenceStop(reading.at(-1)?.word ?? '')[0]
    if (!CONNECTORS.has(last)) readings.push(reading)
  }
  return readings
}

function streetFirstSpan(text: string, match: RegExpExecArray): AddressMarkerSpan | null {
  const [whole, rawType = '', run = ''] = match
  const type = rawType.toLowerCase()
  const typeCapitalised = /^\p{Lu}/u.test(rawType)
  const tokens = tokensOf(run, match.index + whole.length - run.length)
  const { name, named } = streetFirstName(tokens, type)
  if (name.length === 0) return null
  if (!typeCapitalised && PLAIN_CONNECTORS.has(name[0]?.word ?? '')) return null
  const before = numberBefore(text, match.index)
  const lead = leadOf(text, before)
  // A real address followed by a capitalised word of the next sentence
  // (`8 Place de la Concorde Would book again`) is read again, shorter.
  for (const reading of streetFirstReadings(name)) {
    const last = reading.at(-1)
    if (last === undefined) continue
    const nameEnd = trimmedEnd(last)
    const after = typeCapitalised ? numberAfter(text, nameEnd) : -1
    if (before < 0 && (after < 0 || !endsClause(text, after))) continue
    const words = reading.map((token) => withoutSentenceStop(token.word)[0])
    if (rejectsName({ words, type, named, lead, numberFirst: false })) continue
    return withPostalTail(
      text,
      before >= 0 ? before : match.index,
      after >= 0 ? after : nameEnd,
    )
  }
  return null
}

function findStreetFirst(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(STREET_FIRST_RE)) {
    const span = streetFirstSpan(text, match)
    if (span !== null) spans.push(span)
  }
  return spans
}

/** Particles inside the name of a Bulgarian street (`Св. Св. Кирил и Методий`). */
const BULGARIAN_NAME_PARTICLES: ReadonlySet<string> = new Set(['и', 'на', 'от', 'де'])

/**
 * A Bulgarian street's name is quoted or written in capitals, word by word, with
 * a particle between its words: `ул. Витоша`, `бул. „Граф Игнатиев“`. A name
 * typed in lower case (`ул. витоша 25`) counts only when the number ends a clause:
 * `ул. красива маса 2 безплатни` and `бул. работа 10 от 10` are prose.
 */
function bulgarianNameAccepted(name: string, text: string, end: number): boolean {
  if (/^[„"«]/u.test(name)) return true
  const proper = name
    .trim()
    .split(/[ \t]+/u)
    .every(
      (word, index) =>
        /^\p{Lu}/u.test(word) || (index > 0 && BULGARIAN_NAME_PARTICLES.has(word)),
    )
  return proper || endsClause(text, end)
}

function findBulgarianStreets(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(BULGARIAN_STREET_RE)) {
    const end = match.index + match[0].length
    if (!bulgarianNameAccepted(match[2] ?? '', text, end)) continue
    const next = WORD_AFTER_RE.exec(
      text.slice(end, end + NUMBER_FOLLOWER_LOOKAHEAD_SCALARS),
    )?.[1]
    if (next !== undefined && BULGARIAN_QUANTITIES.has(next.toLowerCase())) continue
    spans.push(withPostalTail(text, match.index, end))
  }
  return spans
}

const ADDRESS_FINDERS: ReadonlyArray<(text: string) => readonly AddressMarkerSpan[]> = [
  findNameFirst,
  findSpelledFirst,
  findStreetFirst,
  findNumberLast,
  findBulgarianStreets,
  findForeignAddressMarkers,
]

/** Every address-shaped span of `text`; spans of different layouts may overlap. */
export function findAddressMarkers(text: string): readonly AddressMarkerSpan[] {
  return ADDRESS_FINDERS.flatMap((find) => find(text))
}

const OWN_PATTERNS: readonly Readonly<{ id: string; source: string; flags: string }>[] = (
  [
    ['address_name_first', NAME_FIRST_RE],
    ['address_spelled_first', SPELLED_FIRST_RE],
    ['address_name_first_reread', NAME_FIRST_REREAD_RE],
    ['address_spelled_first_reread', SPELLED_FIRST_REREAD_RE],
    ['address_street_first', STREET_FIRST_RE],
    ['address_number_before', NUMBER_BEFORE_RE],
    ['address_number_after', NUMBER_AFTER_RE],
    ['address_bulgarian_street', BULGARIAN_STREET_RE],
    ['address_postal_tail', POSTAL_TAIL_RE],
  ] as const
).map(([id, expression]) =>
  Object.freeze({ id, source: expression.source, flags: expression.flags }),
)

/** What the detector profile digest records about the address markers. */
export const ADDRESS_MARKER_PROFILE = Object.freeze({
  patterns: Object.freeze([
    ...OWN_PATTERNS,
    ...NUMBER_LAST_PROFILE.patterns,
    ...FOREIGN_ADDRESS_PROFILE.patterns,
  ]),
  wordLists: Object.freeze({
    quantities: QUANTITY_WORDS,
    timeUnits: TIME_UNIT_WORDS,
    softUnits: SOFT_UNIT_WORDS,
    strongGlue: STRONG_GLUE_WORDS,
    weakGlue: WEAK_GLUE_WORDS,
    evaluatives: EVALUATIVE_WORDS,
    nameConnectors: NAME_CONNECTOR_WORDS,
    addressLeads: ADDRESS_LEAD_WORDS,
    addressLabels: ADDRESS_LABEL_WORDS,
    namePrepositions: NAME_PREPOSITION_WORDS,
    evaluativeStreetTypes: EVALUATIVE_STREET_TYPES,
    unitStreetTypes: UNIT_STREET_TYPES,
    clauseStreetTypes: CLAUSE_STREET_TYPES,
    loneNameWords: LONE_NAME_WORDS,
    placePrepositions: PLACE_PREPOSITION_WORDS,
    determiners: DETERMINER_WORDS,
    ratingLeads: RATING_LEAD_WORDS,
    countLeads: COUNT_LEAD_WORDS,
    lowerCaseAbbreviations: LOWER_CASE_ABBREVIATIONS,
    numberWords: NUMBER_WORDS,
    extraStreetTypes: EXTRA_STREET_TYPE_WORDS,
    genericNames: GENERIC_NAME_WORDS,
    countFollowers: COUNT_FOLLOWER_WORDS,
    foreign: FOREIGN_ADDRESS_PROFILE.wordLists,
    bulgarianQuantities: Object.freeze([...BULGARIAN_QUANTITIES].sort()),
  }),
  nameRules: ADDRESS_NAME_RULE_PROFILE,
  abbreviatedTypes: NUMBER_LAST_PROFILE.abbreviatedTypes,
  limits: Object.freeze({
    maxStreetFirstNameWords: MAX_STREET_FIRST_NAME_WORDS,
    numberLast: NUMBER_LAST_PROFILE.limits,
    foreign: FOREIGN_ADDRESS_PROFILE.limits,
    numberFirstLookbehindScalars: NUMBER_FIRST_LOOKBEHIND_SCALARS,
    numberFollowerLookaheadScalars: NUMBER_FOLLOWER_LOOKAHEAD_SCALARS,
  }),
})
