// Number-last addresses of structured-marker-detectors-v1: the street's name and
// type, then the house number.
//
// `Main Street 25`, `Baker Street 221B`, `High Street, 12`, `Station Road no. 5`,
// `Oak Road (no. 12)`, `Oak Road 12/3`, `Oak Road N° 12`, `Oak Road, house 12`,
// `Oak Road, 12th house`, `Oak Street twelve` (ending a clause), and in lower
// case `main street 25`. The street types are the thirteen of the number-first
// layout and, for a proper name written in capitals, the ones of
// `EXTRA_STREET_TYPES` (`Oak Close 12`).
//
// This layout is the more likely to take prose for a street, because the name
// comes first and a number after a street word is often a count (`Main Street 5
// times`, `Station Road 2 stops`, `Great Place 10 out of 10`). So it asks more:
// a count word after the number rules it out, a name that is only praise rules
// it out, and a lower-case name is read only before the street words that are
// rarely anything else.

import {
  CONNECTORS,
  DETERMINERS,
  EVALUATIVE_TYPES,
  EVALUATIVES,
  EXTRA_STREET_TYPES,
  GENERIC_NAMES,
  RATING_LEADS,
} from './ai-address-words'
import {
  LOWER_NAME_WORD_RE,
  NO_LEAD,
  OPEN_STREET_TYPES,
  endsSentence,
  isNameWord,
  rejectsName,
} from './ai-address-name-rules'
import {
  followedByQuantity,
  tokensOf,
  withPostalTail,
  type AddressMarkerSpan,
  type Token,
} from './ai-address-spans'

const MAX_NUMBER_LAST_NAME_WORDS = 4
const NUMBER_LAST_LOOKBEHIND_SCALARS = 96

/*
 * Candidate repetitions are bounded ({1,4}, {0,2}) and every repeated unit ends in
 * a mandatory blank; the input is capped at 65,536 scalars before any pattern
 * runs. The security rule cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/**
 * Number last: a street-type word, a comma or a bracket, a label (`no.`, `house`,
 * `N°`, `#`), and the number: digits with a letter A to E or a flat after a slash
 * (`221B`, `12/3`), `12th house`, or a number written out that ends a clause.
 * `24/7` is not a number.
 */
const NUMBER_LAST_RE =
  /(?<![\p{L}\p{M}])(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|close|crescent|cres|gardens|gdns|square|sq|parkway|pkwy|terrace|ter|grove|circle|cir|walk|trail|loop|highway|hwy|mews|approach|alley|plaza|row)\b(\.?)[ \t]*[,;]?[ \t]*\(?[ \t]*(?:(?:house|haus|no|nr|num|number|№|n°|nº|#)\.?[ \t]*:?[ \t]*){0,2}(\d{1,5}(?:st|nd|rd|th)[ \t]+house|(?!24\/7)\d{1,5}[A-Ea-e]?(?:\/\d{1,4})?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?=[ \t]*(?:[,.;:)\]!?]|[-–][ \t]|$)))(?![\p{L}\p{N}/:%]|\.\d)/giu
/** The words in front of a street-type word: up to four, each with its blank. */
const NAME_BEFORE_RE =
  /((?:(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?)[ \t]+){1,4})$/u
/* eslint-enable security/detect-unsafe-regex */

export const ABBREVIATED_TYPES: ReadonlySet<string> = new Set([
  'st',
  'rd',
  'ave',
  'blvd',
  'ln',
  'dr',
  'ct',
  'pl',
  'sq',
  'cres',
  'gdns',
  'pkwy',
  'hwy',
  'ter',
  'cir',
])

/** The tokens in front of `index` on the same line, nearest last. */
function tokensBefore(text: string, index: number): readonly Token[] {
  let from = Math.max(0, index - NUMBER_LAST_LOOKBEHIND_SCALARS)
  if (from > 0 && /[^ \t]/u.test(text[from - 1] ?? ' ')) {
    const blank = text.slice(from, index).search(/[ \t]/u)
    from = blank < 0 ? index : from + blank + 1
  }
  const found = NAME_BEFORE_RE.exec(text.slice(from, index))
  return found === null ? [] : tokensOf(found[1] ?? '', from + found.index)
}

/** The tail of capitalised words (and particles) just before a street-type word. */
function capitalisedRun(tokens: readonly Token[]): readonly Token[] {
  const kept: Token[] = []
  for (const token of [...tokens].reverse()) {
    if (kept.length >= MAX_NUMBER_LAST_NAME_WORDS) break
    if (endsSentence(token.word)) break
    if (!isNameWord(token.word) && !CONNECTORS.has(token.word)) break
    kept.unshift(token)
  }
  while (kept.length > 0 && !isNameWord(kept[0]?.word ?? '')) kept.shift()
  while (kept.length > 1 && DETERMINERS.has((kept[0]?.word ?? '').toLowerCase()))
    kept.shift()
  return kept
}

/** A name that is nothing but `the`, or praise: not the name of a street. */
function emptyName(words: readonly string[]): boolean {
  const bare = words.map((word) => word.toLowerCase())
  return (
    (bare.length === 1 && bare[0] === 'the') ||
    bare.every((word) => CONNECTORS.has(word) || EVALUATIVES.has(word))
  )
}

/**
 * The longest run of lower-case words in front of the type that still reads as
 * a name, grown one word at a time from the nearest: `faced the main street 25`
 * is `the main`, `walked down main street 25` is `main`.
 */
function plainRun(tokens: readonly Token[], type: string): readonly Token[] {
  let best: readonly Token[] = []
  const kept: Token[] = []
  for (const token of [...tokens].reverse()) {
    if (kept.length >= MAX_NUMBER_LAST_NAME_WORDS) break
    if (endsSentence(token.word) || !LOWER_NAME_WORD_RE.test(token.word)) break
    kept.unshift(token)
    const words = kept.map((entry) => entry.word)
    const shape = { words, type, named: false, lead: NO_LEAD, numberFirst: false }
    if (rejectsName(shape)) break
    if (!emptyName(words)) best = [...kept]
  }
  return best
}

/**
 * Praise or a rank for a place is not a street: `Great Place 10 out of 10`,
 * `Best Way 2`, `Top place 1 in town`. So is a generic noun and a street word,
 * `Hotel Drive 2 beach`, which is how a guest types `to`.
 */
function praiseOnly(words: readonly string[], type: string): boolean {
  const bare = words.map((word) => word.toLowerCase())
  const praise = bare.map((word) => EVALUATIVES.has(word) || RATING_LEADS.has(word))
  return (
    praise.every(Boolean) ||
    (EVALUATIVE_TYPES.has(type) && praise.some(Boolean)) ||
    bare.every((word) => GENERIC_NAMES.has(word))
  )
}

type NameRun = Readonly<{ tokens: readonly Token[]; named: boolean }>

/** The street's name in front of `index`, as capitals or, before a plain type, in lower case. */
function nameRunBefore(text: string, index: number, type: string): NameRun {
  const tokens = tokensBefore(text, index)
  const named = capitalisedRun(tokens)
  if (named.length > 0) return { tokens: named, named: true }
  const plain = OPEN_STREET_TYPES.has(type) ? plainRun(tokens, type) : []
  return { tokens: plain, named: false }
}

function numberLastSpan(text: string, match: RegExpExecArray): AddressMarkerSpan | null {
  const [whole, rawType = '', dot = ''] = match
  const type = rawType.toLowerCase()
  if (dot !== '' && !ABBREVIATED_TYPES.has(type)) return null
  if (EXTRA_STREET_TYPES.has(type) && !/^\p{Lu}/u.test(rawType)) return null
  const { tokens, named } = nameRunBefore(text, match.index, type)
  const first = tokens[0]
  if (first === undefined) return null
  if (EXTRA_STREET_TYPES.has(type) && !named) return null
  const end = match.index + whole.length
  if (followedByQuantity(text, end)) return null
  const words = tokens.map((token) => token.word)
  if (praiseOnly(words, type)) return null
  if (named && rejectsName({ words, type, named, lead: NO_LEAD, numberFirst: false })) {
    return null
  }
  return withPostalTail(text, first.start, end)
}

export function findNumberLast(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(NUMBER_LAST_RE)) {
    const span = numberLastSpan(text, match)
    if (span !== null) spans.push(span)
  }
  return spans
}

/** What the detector profile digest records about the number-last layout. */
export const NUMBER_LAST_PROFILE = Object.freeze({
  patterns: Object.freeze(
    (
      [
        ['address_number_last', NUMBER_LAST_RE],
        ['address_name_before', NAME_BEFORE_RE],
      ] as const
    ).map(([id, expression]) =>
      Object.freeze({ id, source: expression.source, flags: expression.flags }),
    ),
  ),
  abbreviatedTypes: Object.freeze([...ABBREVIATED_TYPES].sort()),
  limits: Object.freeze({
    maxNumberLastNameWords: MAX_NUMBER_LAST_NAME_WORDS,
    numberLastLookbehindScalars: NUMBER_LAST_LOOKBEHIND_SCALARS,
  }),
})
